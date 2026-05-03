// キーワードAPI.gs
const CONFIG_AI = {
  SHEET_AI: "AIキーワード抽出",
  HEADER_ROW: 1,
  START_ROW: 2,
  MAX_PER_RUN: 10,
  MODEL: "gpt-5-mini",
  OPENAI_ENDPOINT: "https://api.openai.com/v1/responses",
  MAX_KEYWORDS: 8,
  MIN_KEYWORDS: 3,
  ONLY_PROCESS_WHEN_FLAG_TRUE: true,
  OPENAI_MAX_OUTPUT_TOKENS: 120,
  OPENAI_REASONING_EFFORT: "minimal",
  OPENAI_TEXT_VERBOSITY: "low",
  API_CALL_LIMIT_PER_DAY: 200,
  BACKOFF_MIN_MINUTES: 3,
  BACKOFF_MAX_MINUTES: 60
};

function processPendingKeywordRows() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;

  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = String(props.getProperty("OPENAI_API_KEY") || "").trim();
    const spreadsheetId = String(props.getProperty("SPREADSHEET_ID") || "").trim();
    const folderId = String(props.getProperty("IMAGE_FOLDER_ID") || "").trim();

    if (!apiKey) throw new Error("OPENAI_API_KEY が未設定です");
    if (!spreadsheetId) throw new Error("SPREADSHEET_ID が未設定です");
    if (!folderId) throw new Error("IMAGE_FOLDER_ID が未設定です");

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sh = ss.getSheetByName(CONFIG_AI.SHEET_AI);
    if (!sh) throw new Error("AIキーワード抽出 シートが見つかりません");

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < CONFIG_AI.START_ROW) return;

    const headers = sh.getRange(CONFIG_AI.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());

    const colId = findCol_(headers, ["管理番号"]);
    const colImg = findCol_(headers, ["画像", "写真"]);
    const colFlag = findCol_(headers, ["再生成フラグ", "再抽出", "再生成"]);
    const colLog = findCol_(headers, ["処理ログ", "ログ", "APIログ"]);

    const kwCols = [];
    for (let i = 1; i <= 8; i++) {
      const c = findCol_(headers, ["キーワード" + i]);
      if (c >= 0) kwCols.push(c);
    }
    const colKwSingle = findCol_(headers, ["キーワード", "AIキーワード", "抽出キーワード"]);

    if (colId < 0) throw new Error("ヘッダー「管理番号」が見つかりません");
    if (colImg < 0) throw new Error("ヘッダー「画像」または「写真」が見つかりません");
    if (colFlag < 0) throw new Error("ヘッダー「再生成フラグ」が見つかりません");
    if (kwCols.length === 0 && colKwSingle < 0) throw new Error("キーワード列が見つかりません（キーワード1..8 または キーワード）");

    const values = sh.getRange(CONFIG_AI.START_ROW, 1, lastRow - CONFIG_AI.START_ROW + 1, lastCol).getValues();
    const folder = DriveApp.getFolderById(folderId);

    let processed = 0;

    for (let i = 0; i < values.length; i++) {
      if (processed >= CONFIG_AI.MAX_PER_RUN) break;

      const row = values[i];
      const rowNo = CONFIG_AI.START_ROW + i;

      const id = String(row[colId] || "").trim();
      if (!id) continue;

      const imgVal = String(row[colImg] || "").trim();
      if (!imgVal) continue;

      const flagOn = isTrue_(row[colFlag]);
      if (CONFIG_AI.ONLY_PROCESS_WHEN_FLAG_TRUE && !flagOn) continue;

      let alreadyFilled = false;
      if (kwCols.length > 0) {
        alreadyFilled = kwCols.some(c => String(row[c] || "").trim() !== "");
      } else {
        alreadyFilled = String(row[colKwSingle] || "").trim() !== "";
      }

      if (alreadyFilled && !flagOn) continue;

      const fileName = extractFilename_(imgVal);
      if (!fileName) {
        writeLog_(sh, rowNo, colLog, "WAIT: 画像ファイル名が取れない img=" + safe_(imgVal));
        continue;
      }

      const keyHash = hashKey_(id + "|" + fileName);
      const now = Date.now();
      const backoffUntil = getBackoffUntil_(props, keyHash);
      if (backoffUntil && now < backoffUntil) {
        writeLog_(sh, rowNo, colLog, "SKIP: BACKOFF中 until=" + new Date(backoffUntil).toISOString() + " id=" + id + " file=" + fileName);
        continue;
      }

      if (!canCallToday_(props)) {
        writeLog_(sh, rowNo, colLog, "STOP: 1日のAPI上限に到達 " + CONFIG_AI.API_CALL_LIMIT_PER_DAY);
        break;
      }

      const blob = findFileBlobByNameDeep_(folder, fileName);
      if (!blob) {
        setBackoff_(props, keyHash, 1);
        writeLog_(sh, rowNo, colLog, "WAIT: Driveで画像が見つからない file=" + safe_(fileName));
        continue;
      }

      const dataUrl = blobToDataUrl_(blob);
      const prompt = buildPrompt_(id);

      let raw = "";
      try {
        incrementTodayCalls_(props);
        raw = callOpenAI_(apiKey, prompt, dataUrl);
      } catch (e) {
        const att = incrementAttempts_(props, keyHash);
        setBackoff_(props, keyHash, att);
        writeLog_(sh, rowNo, colLog, "ERROR: OpenAI失敗 attempt=" + att + " " + safe_(e && e.message ? e.message : String(e)));
        continue;
      }

      if (!raw) {
        const att = incrementAttempts_(props, keyHash);
        setBackoff_(props, keyHash, att);
        writeLog_(sh, rowNo, colLog, "WAIT: キーワード不足（0） attempt=" + att + " raw=EMPTY id=" + id + " file=" + fileName);
        continue;
      }

      const keywords = normalizeKeywords_(raw, id);

      if (keywords.length < CONFIG_AI.MIN_KEYWORDS) {
        const att = incrementAttempts_(props, keyHash);
        setBackoff_(props, keyHash, att);
        writeLog_(sh, rowNo, colLog, "WAIT: キーワード不足（" + keywords.length + "） attempt=" + att + " raw=" + safe_(raw));
        continue;
      }

      const padded = keywords.slice(0, CONFIG_AI.MAX_KEYWORDS);
      while (padded.length < CONFIG_AI.MAX_KEYWORDS) padded.push("");

      if (kwCols.length > 0) {
        const minC = Math.min.apply(null, kwCols);
        const maxC = Math.max.apply(null, kwCols);
        if (maxC - minC === kwCols.length - 1) {
          sh.getRange(rowNo, minC + 1, 1, kwCols.length).setValues([padded]);
        } else {
          for (let k = 0; k < kwCols.length; k++) {
            sh.getRange(rowNo, kwCols[k] + 1).setValue(padded[k] || "");
          }
        }
      } else {
        sh.getRange(rowNo, colKwSingle + 1).setValue(padded.filter(Boolean).join(" "));
      }

      sh.getRange(rowNo, colFlag + 1).setValue(false);

      const propsToDelete = [attemptsKey_(keyHash), backoffKey_(keyHash)];
      props.deleteProperty(propsToDelete[0]);
      props.deleteProperty(propsToDelete[1]);

      writeLog_(sh, rowNo, colLog, "OK: " + padded.filter(Boolean).join(" "));
      processed++;
    }
  } finally {
    lock.releaseLock();
  }
}

function buildPrompt_(id) {
  return [
    "次の画像の商品について、メルカリ向けに検索に強い日本語キーワードを抽出してください。",
    "重要: 管理番号/商品番号/No. 等の識別子は絶対に出力しない（画像内・指示内にあっても禁止）。",
    "重要: ブランド名はロゴが見えても絶対に出力しない。",
    "重要: 色名は絶対に出力しない。",
    "制約:",
    "・画像で確実に確認できる要素だけ（推測は禁止）",
    "・素材/機能/フィット感/伸縮/ウエストゴム/ハイウエスト等は画像で断定できない限り出さない",
    "・具体語（柄/形/ディテール/系統/スタイル）を優先",
    "・ブランド名/サイズ/性別/色名/「シンプル」/ファスナー/ジッパー/ジップ等は禁止",
    "・出力は3〜8個、半角スペース区切りで1行のみ",
    "・説明文や前置きは禁止。1行のみ。",
    "出力例: クルーネック 長袖 ニット セーター チェック柄 グラデーション"
  ].join("\n");
}

function callOpenAI_(apiKey, promptText, dataUrl) {
  const payload = {
    model: CONFIG_AI.MODEL,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: promptText },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ],
    reasoning: { effort: CONFIG_AI.OPENAI_REASONING_EFFORT },
    text: { verbosity: CONFIG_AI.OPENAI_TEXT_VERBOSITY, format: { type: "text" } },
    max_output_tokens: CONFIG_AI.OPENAI_MAX_OUTPUT_TOKENS
  };

  const res = UrlFetchApp.fetch(CONFIG_AI.OPENAI_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: { Authorization: "Bearer " + apiKey },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText() || "";

  if (code < 200 || code >= 300) {
    throw new Error("OpenAI API " + code + " " + body);
  }

  let json;
  try {
    json = JSON.parse(body || "{}");
  } catch (e) {
    throw new Error("OpenAI JSON PARSE ERROR");
  }

  const text = extractTextFromResponse_(json).trim();
  if (!text) throw new Error("EMPTY_TEXT status=" + String(json.status || "") + " reason=" + safe_(json.incomplete_details && json.incomplete_details.reason ? json.incomplete_details.reason : ""));
  return text;
}

function extractTextFromResponse_(json) {
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;

  const texts = [];

  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (!item) continue;
      const content = item.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part) continue;
          if (typeof part.text === "string" && part.text.trim()) texts.push(part.text);
        }
      }
    }
  }

  if (json.text && typeof json.text === "string" && json.text.trim()) texts.push(json.text);

  return texts.join("\n");
}

function normalizeKeywords_(raw, id) {
  const firstLine = String(raw || "").split("\n").map(s => s.trim()).filter(Boolean)[0] || "";
  const line = firstLine.replace(/[、,／/]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = line.split(" ").map(s => s.trim()).filter(Boolean);

  const bannedExact = new Set([
    "シンプル", "ファスナー", "ジッパー", "ジップ", "ジップアップ", "zip", "ZIP",
    "メンズ", "レディース", "ユニセックス",
    "管理番号", "商品番号", "品番", "No.", "NO.", "no."
  ]);

  const bannedContains = [
    "管理番号", "商品番号", "品番", "No:", "NO:", "No.", "NO.", "管理No", "管理Ｎｏ", "管理No.",
    "ウエストゴム", "ハイウエスト", "ローウエスト", "ストレッチ", "伸縮", "裏起毛", "防水", "撥水", "速乾", "吸汗",
    "本革", "レザー", "カウレザー", "スエード",
    "ウール", "綿", "コットン", "麻", "リネン", "シルク", "カシミヤ", "アクリル", "レーヨン", "ナイロン", "ポリエステル",
    "素材", "混", "％"
  ];

  const bannedColors = new Set([
    "黒", "ブラック", "白", "ホワイト", "グレー", "灰色", "チャコール", "アイボリー", "クリーム",
    "ベージュ", "ブラウン", "茶", "キャメル", "モカ",
    "ネイビー", "紺", "ブルー", "青", "サックス",
    "レッド", "赤", "ボルドー", "エンジ", "ワイン", "ワインレッド",
    "グリーン", "緑", "カーキ", "オリーブ",
    "ピンク", "ダスティピンク",
    "イエロー", "黄", "マスタード",
    "オレンジ", "パープル", "紫",
    "シルバー", "銀", "ゴールド", "金"
  ]);

  const alphaSize = /^(XXS|XS|S|M|L|XL|XXL|3L|4L|5L)$/i;
  const sizeNum = /^[0-9]+(cm|mm)?$/i;

  const idStr = String(id || "").trim();
  const idNoSymbol = idStr ? idStr.replace(/\s+/g, "") : "";

  const out = [];
  const seen = new Set();

  for (const p0 of parts) {
    if (!p0) continue;

    const p = String(p0).replace(/^[\u3000\s]+|[\u3000\s]+$/g, "");
    if (!p) continue;

    const pNorm = p.replace(/[：]/g, ":");

    if (pNorm.indexOf(":") >= 0) {
      const left = pNorm.split(":")[0];
      if (left === "管理番号" || left === "商品番号" || left === "品番" || left.toUpperCase() === "NO") continue;
    }

    if (bannedExact.has(p)) continue;
    if (alphaSize.test(p) || sizeNum.test(p)) continue;
    if (bannedColors.has(p)) continue;
    if (idNoSymbol && (p === idNoSymbol || pNorm === idNoSymbol || pNorm.indexOf(idNoSymbol) >= 0)) continue;
    if (/^[0-9a-f]{8,}$/i.test(p)) continue;
    if (/^[A-Za-z]{0,4}\d{2,8}$/i.test(p)) continue;
    if (/^[A-Za-z0-9&._-]+$/.test(p) && p.length >= 2) continue;

    let bad = false;
    for (const bc of bannedContains) {
      if (p.indexOf(bc) >= 0) { bad = true; break; }
    }
    if (bad) continue;

    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(p);
    if (out.length >= CONFIG_AI.MAX_KEYWORDS) break;
  }

  return out;
}

function findCol_(headers, names) {
  const set = new Set(names.map(s => String(s).trim()));
  for (let i = 0; i < headers.length; i++) {
    if (set.has(headers[i])) return i;
  }
  return -1;
}

function isTrue_(v) {
  if (v === true) return true;
  const s = String(v || "").trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES";
}

function extractFilename_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const parts = s.split(/[\/\\]/);
  return parts[parts.length - 1].trim();
}

function findFileBlobByNameDeep_(folder, filename) {
  const it = folder.getFilesByName(filename);
  if (it.hasNext()) return it.next().getBlob();
  const sub = folder.getFolders();
  while (sub.hasNext()) {
    const f = sub.next();
    const it2 = f.getFilesByName(filename);
    if (it2.hasNext()) return it2.next().getBlob();
  }
  return null;
}

function blobToDataUrl_(blob) {
  const ct = blob.getContentType() || "image/jpeg";
  const b64 = Utilities.base64Encode(blob.getBytes());
  return "data:" + ct + ";base64," + b64;
}

function writeLog_(sh, rowNo, colLog, msg) {
  Logger.log(msg);
  if (colLog >= 0) sh.getRange(rowNo, colLog + 1).setValue(msg);
}

function safe_(s) {
  const t = String(s || "");
  return t.length > 500 ? t.slice(0, 500) + "..." : t;
}

function todayKey_() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + m + day;
}

function canCallToday_(props) {
  const key = "CALLS_" + todayKey_();
  const n = Number(props.getProperty(key) || "0");
  return n < CONFIG_AI.API_CALL_LIMIT_PER_DAY;
}

function incrementTodayCalls_(props) {
  const key = "CALLS_" + todayKey_();
  const n = Number(props.getProperty(key) || "0") + 1;
  props.setProperty(key, String(n));
}

function hashKey_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    hex += ("0" + b.toString(16)).slice(-2);
  }
  return hex;
}

function attemptsKey_(hash) { return "ATTEMPTS_" + hash; }
function backoffKey_(hash) { return "BACKOFF_UNTIL_" + hash; }

function incrementAttempts_(props, hash) {
  const k = attemptsKey_(hash);
  const n = Number(props.getProperty(k) || "0") + 1;
  props.setProperty(k, String(n));
  return n;
}

function clearAttempts_(props, hash) { props.deleteProperty(attemptsKey_(hash)); }

function getBackoffUntil_(props, hash) {
  const v = props.getProperty(backoffKey_(hash));
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function setBackoff_(props, hash, attempts) {
  const base = CONFIG_AI.BACKOFF_MIN_MINUTES;
  const maxm = CONFIG_AI.BACKOFF_MAX_MINUTES;
  let mins = base * Math.pow(2, Math.max(0, attempts - 1));
  if (mins > maxm) mins = maxm;
  const until = Date.now() + mins * 60 * 1000;
  props.setProperty(backoffKey_(hash), String(until));
}

function clearBackoff_(props, hash) { props.deleteProperty(backoffKey_(hash)); }
