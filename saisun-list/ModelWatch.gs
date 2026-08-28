// =====================================================
// ModelWatch — 課金APIモデルの鮮度チェック
// =====================================================
//
// 目的:
//   「常に最新モデル・ただし最初に選んだ価格帯のまま」を保つための監視。
//   毎日 cronDaily8 から走り、異常や候補が見つかったときだけメールで知らせる。
//
// なぜ自動で書き換えないか:
//   1) 価格はどのプロバイダのAPIも返さない。OpenAI /v1/models が返すのは
//      id / created / owned_by / shutdown_date のみ。価格帯の維持は機械判定できない。
//   2) モデル名から価格帯を推測できない改名が実際に起きている
//      （gpt-5-mini → GPT-5.6 Luna。名前に mini も nano も入っていない）。
//   3) パラメータの非互換が実在する。gpt-5.6-luna は reasoning.effort:"minimal" を
//      受け付けず 400 を返す。モデルだけ差し替えると本番が止まる。
//   そのため「検知・実呼び出しでの検証・通知」までを自動化し、
//   ソース変更と本番デプロイは人間の承認後に行う。
//
// Gemini について:
//   本番は公式エイリアス（gemini-flash-lite-latest）を使っており、
//   最新への追従は Google 側で完結している。ここでは
//   「エイリアスの実体が変わって壊れていないか」だけを見る。
//   GEMINI_API_KEY は gas-proxy Worker の secret にしか無いので、
//   Worker の GET /admin/model-health を叩いて結果をもらう（キーを複製しない）。
//
// 手動実行: modelWatch_runNow()  … 結果をログに出し、メールも送る
//           modelWatch_preview() … メールを送らずログだけ

var MODELWATCH_CONFIG = {
  OPENAI_MODELS_URL: 'https://api.openai.com/v1/models',
  OPENAI_CHAT_URL: 'https://api.openai.com/v1/chat/completions',
  OPENAI_RESPONSES_URL: 'https://api.openai.com/v1/responses',
  // 廃止予告が何日先に迫ったら「要対応」に格上げするか
  SHUTDOWN_WARN_DAYS: 90,
  // 同じ内容のメールを毎日送らないための署名保存先
  SIGNATURE_PROP: 'MODELWATCH_LAST_SIGNATURE'
};

/**
 * 監視対象。call site ごとではなく「モデル × API × パラメータ形」でまとめる。
 * パラメータ形が違えば別エントリにする（非互換はそこにしか現れないため）。
 */
var MODELWATCH_TARGETS = [
  {
    label: '記事・ニュースレター・GA4助言・チャットボット',
    model: 'gpt-5.6-luna',
    family: 'gpt-5',
    api: 'chat',
    tier: '低価格帯（入力$0.20 / 出力$1.20・2026-08-29 選定時）',
    sites: [
      'saisun-list/Articles.gs:15 記事生成',
      'saisun-list/Newsletter.gs:8 ニュースレター',
      'saisun-list/WeeklyNewsletter.gs:478 週次ニュースレター',
      'saisun-list/GA4Advice.gs:583 GA4改善アドバイス',
      'saisun-list/Chatbot.gs:29 チャットボット'
    ],
    params: { max_completion_tokens: 2000 }
  },
  {
    label: 'AIキーワード抽出',
    model: 'gpt-5.6-luna',
    family: 'gpt-5',
    api: 'responses',
    tier: '低価格帯（入力$0.20 / 出力$1.20・2026-08-29 選定時）',
    sites: ['shiire-kanri/キーワードAPI.gs:7 AIキーワード抽出'],
    // effort と verbosity を本番と同じ値で送る。ここが非互換検知の要
    params: { max_output_tokens: 120, reasoning: { effort: 'none' }, text: { verbosity: 'low' } }
  },
  {
    label: 'メルカリ受注判定',
    model: 'gpt-4o-mini',
    family: 'gpt-4o',
    api: 'chat',
    tier: '旧世代のまま据置（入力$0.15 / 出力$0.60）',
    sites: ['saisun-list/受注管理.gs:18 メルカリ受注判定'],
    params: { max_completion_tokens: 2000 }
  },
  {
    label: '一括記事Cron',
    model: 'gpt-4o-mini',
    family: 'gpt-4o',
    api: 'chat',
    tier: '旧世代のまま据置（入力$0.15 / 出力$0.60）',
    sites: ['saisun-list-bulk/CronArticles.gs:12 一括記事生成'],
    // 旧形式（max_tokens + temperature）。新世代モデルでは弾かれることがある
    params: { max_tokens: 400, temperature: 0.7 }
  }
];

// =====================================================
// エントリポイント
// =====================================================

/** cronDaily8 から呼ばれる本体。変化があったときだけメールする */
function modelWatch_cron() {
  try {
    var report = modelWatch_collect_();
    modelWatch_notifyIfChanged_(report);
  } catch (e) {
    console.error('[ModelWatch] 失敗: ' + e.message);
  }
}

/** GASエディタから手動実行（メールも送る） */
function modelWatch_runNow() {
  var report = modelWatch_collect_();
  console.log(modelWatch_buildBody_(report));
  modelWatch_sendMail_(report, true);
  return report;
}

/** GASエディタから手動実行（メールを送らず内容だけ確認） */
function modelWatch_preview() {
  var report = modelWatch_collect_();
  console.log(modelWatch_buildBody_(report));
  return report;
}

// =====================================================
// 収集
// =====================================================

function modelWatch_collect_() {
  var report = {
    checkedAt: new Date(),
    problems: [],   // 要対応
    candidates: [], // 新モデル候補（価格は人間が確認）
    notes: [],      // 参考情報
    openai: [],
    gemini: null
  };

  modelWatch_collectOpenAi_(report);
  modelWatch_collectGemini_(report);
  return report;
}

function modelWatch_collectOpenAi_(report) {
  var apiKey = String(PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '').trim();
  if (!apiKey) {
    report.problems.push('【要対応】OPENAI_API_KEY が未設定のため OpenAI 側を確認できません');
    return;
  }

  // 1. 利用可能モデル一覧（shutdown_date 付き）
  var listed = {};
  try {
    var res = UrlFetchApp.fetch(MODELWATCH_CONFIG.OPENAI_MODELS_URL, {
      headers: { Authorization: 'Bearer ' + apiKey },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      report.problems.push('【要対応】OpenAI /v1/models が HTTP ' + res.getResponseCode());
      return;
    }
    var data = JSON.parse(res.getContentText()).data || [];
    for (var i = 0; i < data.length; i++) listed[data[i].id] = data[i];
  } catch (e) {
    report.problems.push('【要対応】OpenAI モデル一覧の取得に失敗: ' + e.message);
    return;
  }

  var now = new Date();
  var seenModels = {};

  for (var t = 0; t < MODELWATCH_TARGETS.length; t++) {
    var tgt = MODELWATCH_TARGETS[t];
    var info = listed[tgt.model];
    var entry = { label: tgt.label, model: tgt.model, api: tgt.api, tier: tgt.tier, sites: tgt.sites };

    // --- 存在確認 ---
    if (!info) {
      report.problems.push('【要対応】' + tgt.label + ' の ' + tgt.model +
        ' がモデル一覧から消えています（廃止済み）。差し替えが必要です');
      entry.exists = false;
    } else {
      entry.exists = true;

      // --- 廃止予告 ---
      if (info.shutdown_date) {
        entry.shutdownDate = info.shutdown_date;
        var days = Math.round((new Date(info.shutdown_date + 'T00:00:00Z') - now) / 86400000);
        entry.shutdownInDays = days;
        if (days <= MODELWATCH_CONFIG.SHUTDOWN_WARN_DAYS) {
          report.problems.push('【要対応】' + tgt.label + ' の ' + tgt.model +
            ' は ' + info.shutdown_date + ' に廃止（あと' + days + '日）');
        } else {
          report.notes.push(tgt.label + '（' + tgt.model + '）の廃止予定日: ' + info.shutdown_date +
            '（あと' + days + '日）');
        }
      }
    }

    // --- 実パラメータでのスモークテスト ---
    entry.smoke = modelWatch_smokeOpenAi_(apiKey, tgt);
    if (!entry.smoke.ok) {
      report.problems.push('【要対応】' + tgt.label + '（' + tgt.model + ' / ' + tgt.api +
        '）が本番と同じパラメータで失敗: ' + entry.smoke.reason);
    }

    // --- 同ファミリの新モデル候補（モデルごとに1回だけ）---
    if (info && !seenModels[tgt.model]) {
      seenModels[tgt.model] = true;
      var newer = modelWatch_findNewer_(listed, tgt.family, info.created);
      if (newer.length) {
        entry.newer = newer;
        report.candidates.push({
          current: tgt.model,
          tier: tgt.tier,
          sites: tgt.sites,
          newer: newer
        });
      }
    }

    report.openai.push(entry);
  }
}

/** created が現行より新しい同ファミリのモデルを拾う（日付固定版・特殊用途は除外） */
function modelWatch_findNewer_(listed, family, currentCreated) {
  var out = [];
  for (var id in listed) {
    if (id.indexOf(family) !== 0) continue;
    if (!listed[id].created || listed[id].created <= currentCreated) continue;
    // 日付サフィックス付き（gpt-5-mini-2025-08-07）とチャット/コーデックス等の特殊系は除外
    if (/-\d{4}-\d{2}-\d{2}$/.test(id)) continue;
    if (/(codex|audio|realtime|search|image|transcribe|tts|chat-latest)/.test(id)) continue;
    if (listed[id].shutdown_date) continue; // 廃止予定のものを勧めない
    out.push(id);
  }
  return out.sort();
}

/** 本番と同じ API・パラメータで実際に叩く。ここで非互換とレスポンス空を捕まえる */
function modelWatch_smokeOpenAi_(apiKey, tgt) {
  var prompt = '「テスト成功」とだけ日本語で返してください。';
  var url, payload;

  if (tgt.api === 'responses') {
    url = MODELWATCH_CONFIG.OPENAI_RESPONSES_URL;
    payload = { model: tgt.model, input: prompt };
  } else {
    url = MODELWATCH_CONFIG.OPENAI_CHAT_URL;
    payload = { model: tgt.model, messages: [{ role: 'user', content: prompt }] };
  }
  for (var k in tgt.params) payload[k] = tgt.params[k];

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var txt = res.getContentText();
    if (code !== 200) {
      var msg = txt;
      try { msg = JSON.parse(txt).error.message; } catch (e) {}
      return { ok: false, reason: 'HTTP ' + code + ' ' + String(msg).slice(0, 200) };
    }
    var body = JSON.parse(txt);
    var content = '';
    if (tgt.api === 'responses') {
      var output = body.output || [];
      for (var i = 0; i < output.length; i++) {
        var parts = output[i].content || [];
        for (var j = 0; j < parts.length; j++) {
          if (parts[j].type === 'output_text') content += parts[j].text || '';
        }
      }
    } else {
      content = ((body.choices || [{}])[0].message || {}).content || '';
    }
    if (!String(content).trim()) {
      return { ok: false, reason: '応答が空（推論トークンが出力枠を使い切った可能性）' };
    }
    return { ok: true, sample: String(content).slice(0, 60) };
  } catch (e) {
    return { ok: false, reason: '呼び出し例外: ' + e.message };
  }
}

/** Gemini は gas-proxy Worker に問い合わせる（キーを GAS 側へ複製しないため） */
function modelWatch_collectGemini_(report) {
  var props = PropertiesService.getScriptProperties();
  var base = String(props.getProperty('WORKERS_URL') || props.getProperty('WORKERS_API_URL') || '').trim();
  var secret = String(props.getProperty('SYNC_SECRET') || '').trim();
  if (!base || !secret) {
    report.notes.push('WORKERS_URL または SYNC_SECRET が未設定のため Gemini 側は未確認');
    return;
  }
  try {
    var url = base.replace(/\/+$/, '') + '/admin/model-health?key=' + encodeURIComponent(secret);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      report.problems.push('【要対応】Gemini チェック用エンドポイントが HTTP ' + res.getResponseCode());
      return;
    }
    var j = JSON.parse(res.getContentText());
    report.gemini = j;
    if (!j.ok) {
      report.problems.push('【要対応】Gemini チェック失敗: ' + (j.error || '不明'));
      return;
    }
    for (var i = 0; i < (j.problems || []).length; i++) report.problems.push(j.problems[i]);
  } catch (e) {
    report.problems.push('【要対応】Gemini チェックの呼び出しに失敗: ' + e.message);
  }
}

// =====================================================
// 通知
// =====================================================

/** 前回と同じ内容なら送らない（毎日同じメールが届くのを防ぐ） */
function modelWatch_notifyIfChanged_(report) {
  var signature = JSON.stringify({ p: report.problems, c: report.candidates });
  var props = PropertiesService.getScriptProperties();
  var last = props.getProperty(MODELWATCH_CONFIG.SIGNATURE_PROP) || '';

  var hasNews = report.problems.length > 0 || report.candidates.length > 0;
  if (!hasNews) {
    // 全部解消したときだけ「解消しました」を送り、以後は静かにする
    if (last && last !== '[]') {
      modelWatch_sendMail_(report, true);
    }
    props.setProperty(MODELWATCH_CONFIG.SIGNATURE_PROP, '[]');
    return;
  }
  if (signature === last) return; // 同じ指摘は再送しない
  modelWatch_sendMail_(report, false);
  props.setProperty(MODELWATCH_CONFIG.SIGNATURE_PROP, signature);
}

function modelWatch_sendMail_(report, isAllClear) {
  var props = PropertiesService.getScriptProperties();
  var to = String(props.getProperty('ADMIN_OWNER_EMAIL') || APP_CONFIG.notifyEmails || '')
    .split(',')[0].trim();
  if (!to) {
    console.warn('[ModelWatch] 送信先が未設定のためメールを送りません');
    return;
  }
  var subject = isAllClear
    ? '[ModelWatch] 指摘は解消しました'
    : '[ModelWatch] ' + (report.problems.length ? '要対応 ' + report.problems.length + '件' : '新モデル候補あり');
  MailApp.sendEmail(to, subject, modelWatch_buildBody_(report));
}

function modelWatch_buildBody_(report) {
  var tz = Session.getScriptTimeZone();
  var lines = [];
  lines.push('課金APIモデルの鮮度チェック');
  lines.push('実行日時: ' + Utilities.formatDate(report.checkedAt, tz, 'yyyy-MM-dd HH:mm'));
  lines.push('');

  if (report.problems.length) {
    lines.push('■ 要対応（' + report.problems.length + '件）');
    for (var i = 0; i < report.problems.length; i++) lines.push('  ' + report.problems[i]);
    lines.push('');
  } else {
    lines.push('■ 要対応: なし');
    lines.push('');
  }

  if (report.candidates.length) {
    lines.push('■ 新しいモデルが出ています（価格を確認してから判断してください）');
    for (var c = 0; c < report.candidates.length; c++) {
      var cand = report.candidates[c];
      lines.push('  現行: ' + cand.current + '  ' + cand.tier);
      lines.push('  候補: ' + cand.newer.join(', '));
      lines.push('  影響範囲:');
      for (var s = 0; s < cand.sites.length; s++) lines.push('    - ' + cand.sites[s]);
      lines.push('');
    }
    lines.push('  ※ 価格はAPIから取得できません。単価表で価格帯が同じか確認してください。');
    lines.push('    https://platform.openai.com/docs/pricing');
    lines.push('');
  }

  lines.push('■ 現状（OpenAI）');
  for (var o = 0; o < report.openai.length; o++) {
    var e = report.openai[o];
    lines.push('  ' + e.label);
    lines.push('    モデル: ' + e.model + ' / ' + e.api + (e.exists ? '' : '  ← 一覧に存在しません'));
    lines.push('    価格帯: ' + e.tier);
    lines.push('    実呼び出し: ' + (e.smoke && e.smoke.ok ? 'OK' : 'NG ' + (e.smoke ? e.smoke.reason : '')));
    if (e.shutdownDate) lines.push('    廃止予定: ' + e.shutdownDate);
  }
  lines.push('');

  lines.push('■ 現状（Gemini）');
  if (report.gemini && report.gemini.ok) {
    for (var g = 0; g < report.gemini.models.length; g++) {
      var m = report.gemini.models[g];
      lines.push('  ' + m.role + ': ' + m.model +
        (m.listed ? '' : '  ← 一覧に存在しません') +
        (m.smoke ? '  実呼び出し: ' + (m.smoke.ok ? 'OK' : 'NG ' + m.smoke.reason) : ''));
    }
  } else {
    lines.push('  未確認');
  }

  if (report.notes.length) {
    lines.push('');
    lines.push('■ 参考');
    for (var n = 0; n < report.notes.length; n++) lines.push('  ' + report.notes[n]);
  }

  return lines.join('\n');
}
