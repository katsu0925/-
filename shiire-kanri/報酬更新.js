// 報酬更新.gs
function updateRewardsNoFormula(allMonths) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shR = ss.getSheetByName('報酬管理');
  var shM = ss.getSheetByName('作業者マスター');
  var shP = ss.getSheetByName('商品管理');
  var shS = ss.getSheetByName('仕入れ管理');
  var shE = ss.getSheetByName('経費申請');
  if (!shR || !shM || !shP || !shS || !shE) return;

  function pad2(n){return ('0'+n).slice(-2)}
  function ymKey(d){if(!(d instanceof Date))return ''; var y=d.getFullYear(); var m=pad2(d.getMonth()+1); return y+'/'+m}
  function parseYM(s){if(!s)return null; s=String(s).trim(); var m=s.match(/^(\d{4})[\/\-\.](\d{1,2})$/); if(!m)return null; return {y:parseInt(m[1],10),m:parseInt(m[2],10)}}
  function mkIndex(mk){var a=mk.split('/'); return parseInt(a[0],10)*12+parseInt(a[1],10)-1}
  function col_(a1){var s=0; for (var i=0;i<a1.length;i++){ s=s*26+(a1.charCodeAt(i)-64) } return s}
  function toNum(v){if(typeof v==='number')return v; var n=parseFloat(String(v).replace(/[^\d\.\-]/g,'')); return isNaN(n)?0:n}
  function minDate(a,b){var x=a instanceof Date?a:null; var y=b instanceof Date?b:null; if(x&&y) return x<y?x:y; return x||y}
  function min3(a,b,c){var arr=[]; if(a instanceof Date)arr.push(a); if(b instanceof Date)arr.push(b); if(c instanceof Date)arr.push(c); if(!arr.length)return null; arr.sort(function(p,q){return p-q}); return arr[0]}
  function norm(s){return String(s||'').replace(/\u3000/g,' ').trim()}

  var ts = new Date();
  var today = new Date(); today.setHours(0,0,0,0);
  var curMK = ymKey(today);
  var prevDate = new Date(today.getFullYear(), today.getMonth()-1, 1);
  var prevMK = ymKey(prevDate);
  var curIdx = mkIndex(curMK);
  var prevIdx = mkIndex(prevMK);
  Logger.log('START updateRewardsNoFormula at %s curMK=%s prevMK=%s', ts.toISOString(), curMK, prevMK);

  var startRow = 3;
  var lastRowR = shR.getLastRow();
  if (lastRowR < startRow) return;
  var abVals = shR.getRange(startRow,1,lastRowR-startRow+1,2).getValues();

  var updateRows = [];
  var monthsSet = {};
  for (var i=0;i<abVals.length;i++){
    var p = parseYM(abVals[i][0]);
    var name = norm(abVals[i][1]);
    if(!p || !name) continue;
    var mk = p.y+'/'+pad2(p.m);
    var idx = mkIndex(mk);
    if (allMonths || idx===curIdx || idx===prevIdx){
      updateRows.push({row:startRow+i,mk:mk,idx:idx,name:name});
      monthsSet[mk]=true;
    }
  }
  if (updateRows.length===0) { Logger.log('No target rows'); return; }

  var months = Object.keys(monthsSet).sort(function(x,y){return mkIndex(x)-mkIndex(y)});
  var firstIdx = mkIndex(months[0]);
  Logger.log('Target months=%s rows=%s firstIdx=%s', JSON.stringify(months), updateRows.length, firstIdx);

  var lastRowM = shM.getLastRow();
  var nM = Math.max(0,lastRowM-1);
  var masterVals = nM? shM.getRange(2,2,nM,12).getValues():[];
  var qVals = nM? shM.getRange(2,col_('Q'),nM,1).getValues().flat():[];
  var rates = {};
  for (var j=0;j<masterVals.length;j++){
    var nm = norm(masterVals[j][0]);
    if(!nm) continue;
    rates[nm] = {
      F:+(toNum(masterVals[j][4])||0),
      G:+(toNum(masterVals[j][5])||0),
      H:+(toNum(masterVals[j][6])||0),
      I:+(toNum(masterVals[j][7])||0),
      J:+(toNum(masterVals[j][8])||0),
      K:+(toNum(masterVals[j][9])||0),
      L:+(toNum(masterVals[j][10])||0),
      M:+(toNum(masterVals[j][11])||0),
      Q:norm(qVals[j])
    };
    Logger.log('MASTER name=%s K(%%)=%s Q(%%対象)=%s', nm, rates[nm].K, rates[nm].Q);
  }

  // 改善: 16回の個別 getRange → 1回のバッチ読み取り
  var lastRowP = shP.getLastRow();
  var nP = Math.max(0,lastRowP-1);
  var lastColP = nP ? shP.getLastColumn() : 0;
  var allP = nP ? shP.getRange(2, 1, nP, lastColP).getValues() : [];
  var _c = function(a1) { return col_(a1) - 1; }; // 0-based index
  var AI=[],AJ=[],AG=[],AH=[],AK=[],AL=[],BE=[],BF=[],AP=[],AV=[],AY=[],BH=[],BI=[],BA=[],CN=[],AM=[];
  for (var pi=0; pi<nP; pi++) {
    var pr = allP[pi];
    AI[pi]=pr[_c('AI')]; AJ[pi]=pr[_c('AJ')]; AG[pi]=pr[_c('AG')]; AH[pi]=pr[_c('AH')];
    AK[pi]=pr[_c('AK')]; AL[pi]=pr[_c('AL')]; BE[pi]=pr[_c('BE')]; BF[pi]=pr[_c('BF')];
    AP[pi]=pr[_c('AP')]; AV[pi]=pr[_c('AV')]; AY[pi]=pr[_c('AY')]; BH[pi]=pr[_c('BH')];
    BI[pi]=pr[_c('BI')]; BA[pi]=pr[_c('BA')]; CN[pi]=pr[2]; AM[pi]=pr[_c('AM')];
  }

  var cntAI_AJ = {};
  var cntAG_AH = {};
  var cntAK_AL = {};
  var cntBE_BF = {};
  var salesByNameMonth = {};
  var salesByNameMonthAcc = {};
  var salesByAccMonth = {};
  var accountsByNameMonth = {};
  var accountsByMonth = {};
  var invDeltaByName = {};
  var invBaseByName = {};

  for (var r=0;r<nP;r++){
    var nameAJ = norm(AJ[r]);
    var nameAH = norm(AH[r]);
    var nameAL = norm(AL[r]);
    var nameBF = norm(BF[r]);
    var nameBA = norm(BA[r]);
    var cNm = norm(CN[r]);
    var acc = norm(AM[r]);

    var dAI = AI[r] instanceof Date ? AI[r] : null;
    var dAG = AG[r] instanceof Date ? AG[r] : null;
    var dAK = AK[r] instanceof Date ? AK[r] : null;
    var dBE = BE[r] instanceof Date ? BE[r] : null;
    var dAP = AP[r] instanceof Date ? AP[r] : null;

    if (dAI && nameAJ){ var k1 = ymKey(dAI)+'|'+nameAJ; cntAI_AJ[k1]=(cntAI_AJ[k1]||0)+1 }
    if (dAG && nameAH){ var k2 = ymKey(dAG)+'|'+nameAH; cntAG_AH[k2]=(cntAG_AH[k2]||0)+1 }
    if (dAK && nameAL){ var k3 = ymKey(dAK)+'|'+nameAL; cntAK_AL[k3]=(cntAK_AL[k3]||0)+1 }
    if (dBE && nameBF){ var k4 = ymKey(dBE)+'|'+nameBF; cntBE_BF[k4]=(cntBE_BF[k4]||0)+1 }

    if (dAP){
      var mk = ymKey(dAP);
      var amt = toNum(AV[r]||0);
      if (cNm){ var keyNM = mk+'|'+cNm; salesByNameMonth[keyNM]=(salesByNameMonth[keyNM]||0)+amt }
      if (cNm && acc){ var keyNMA = mk+'|'+cNm+'|'+acc; salesByNameMonthAcc[keyNMA]=(salesByNameMonthAcc[keyNMA]||0)+amt }
      if (acc){ var keyA = mk+'|'+acc; salesByAccMonth[keyA]=(salesByAccMonth[keyA]||0)+amt }
      if (cNm && acc){ accountsByNameMonth[keyNM]=accountsByNameMonth[keyNM]||{}; accountsByNameMonth[keyNM][acc]=(accountsByNameMonth[keyNM][acc]||0)+amt }
      if (acc){ accountsByMonth[mk]=accountsByMonth[mk]||{}; accountsByMonth[mk][acc]=(accountsByMonth[mk][acc]||0)+amt }
    }

    if (nameBA){
      var entry = minDate(dAG,dAI);
      if (entry){
        var eMK = ymKey(entry);
        var eIdx = mkIndex(eMK);
        var exit = min3(AP[r],BH[r],BI[r]);
        var xMK = exit? ymKey(exit):null;
        var xIdx = exit? mkIndex(xMK):null;
        if (eIdx<firstIdx){ invBaseByName[nameBA]=(invBaseByName[nameBA]||0)+1 }
        else { invDeltaByName[nameBA]=invDeltaByName[nameBA]||{}; invDeltaByName[nameBA][eMK]=(invDeltaByName[nameBA][eMK]||0)+1 }
        if (exit){
          if (xIdx<=firstIdx){ invBaseByName[nameBA]=(invBaseByName[nameBA]||0)-1 }
          else { invDeltaByName[nameBA]=invDeltaByName[nameBA]||{}; invDeltaByName[nameBA][xMK]=(invDeltaByName[nameBA][xMK]||0)-1 }
        }
      }
    }
  }
  Logger.log('Built sales maps: nameMonth=%s nameMonthAcc=%s accMonth=%s', Object.keys(salesByNameMonth).length, Object.keys(salesByNameMonthAcc).length, Object.keys(salesByAccMonth).length);

  var invCumByName = {};
  for (var nm in invDeltaByName){
    var base = invBaseByName[nm]||0;
    var cum = base;
    invCumByName[nm]={};
    for (var t=0;t<months.length;t++){
      var mk = months[t];
      var delta = (invDeltaByName[nm][mk]||0);
      cum += delta;
      invCumByName[nm][mk]=cum;
    }
  }
  for (var nm2 in invBaseByName){
    if (!invCumByName[nm2]){
      var base2 = invBaseByName[nm2]||0;
      var cum2 = base2;
      invCumByName[nm2]={};
      for (var t2=0;t2<months.length;t2++){
        var mk2 = months[t2];
        invCumByName[nm2][mk2]=cum2;
      }
    }
  }

  var lastRowE = shE.getLastRow();
  var nE = Math.max(0,lastRowE-1);
  var eDate = nE? shE.getRange(2,5,nE,1).getValues().flat():[];
  var eName = nE? shE.getRange(2,3,nE,1).getValues().flat():[];
  var eAmt  = nE? shE.getRange(2,9,nE,1).getValues().flat():[];
  var expByNameMonth = {};
  for (var i5=0;i5<nE;i5++){
    var nm3 = norm(eName[i5]);
    var dt3 = eDate[i5] instanceof Date ? eDate[i5] : null;
    var v3 = toNum(eAmt[i5]||0);
    if (!nm3 || !dt3) continue;
    var mk3 = ymKey(dt3);
    expByNameMonth[nm3]=expByNameMonth[nm3]||{};
    expByNameMonth[nm3][mk3]=(expByNameMonth[nm3][mk3]||0)+v3;
  }

  for (var u=0; u<updateRows.length; u++){
    var row = updateRows[u];
    var mk = row.mk;
    var name = row.name;
    var rate = rates[name]||{F:0,G:0,H:0,I:0,J:0,K:0,L:0,M:0,Q:''};

    var dVal = (cntAI_AJ[mk+'|'+name]||0) * rate.G;
    var eVal = (cntAG_AH[mk+'|'+name]||0) * rate.F;
    var fVal = (cntAK_AL[mk+'|'+name]||0) * rate.H;
    var gVal = (cntBE_BF[mk+'|'+name]||0) * rate.I;
    var invCnt = (invCumByName[name]&&invCumByName[name][mk])||0;
    var hVal = invCnt * rate.M;
    var iVal = rate.J;
    var jVal = (expByNameMonth[name]&&expByNameMonth[name][mk])||0;

    var kBaseAll = salesByNameMonth[mk+'|'+name]||0;
    var accTarget = norm(rate.Q);
    var kBaseAccName = accTarget ? (salesByNameMonthAcc[mk+'|'+name+'|'+accTarget]||0) : 0;
    var kBaseAccOnly = accTarget ? (salesByAccMonth[mk+'|'+accTarget]||0) : 0;
    var kBase = accTarget ? (kBaseAccName || kBaseAccOnly) : kBaseAll;
    var kVal = kBase * (rate.K/100);
    var lVal = rate.L;

    var knownByName = accountsByNameMonth[mk+'|'+name] ? Object.keys(accountsByNameMonth[mk+'|'+name]) : [];
    var knownByMonth = accountsByMonth[mk] ? Object.keys(accountsByMonth[mk]) : [];
    Logger.log('WRITE row=%s month=%s name=%s Q=%s K(%%)=%s salesAll=%s salesAccName=%s salesAccOnly=%s used=%s knownAMByName=%s knownAMByMonth=%s',
               row.row, mk, name, accTarget, rate.K, kBaseAll, kBaseAccName, kBaseAccOnly, kBase, JSON.stringify(knownByName), JSON.stringify(knownByMonth));

    shR.getRange(row.row,4,1,9).setValues([[dVal,eVal,fVal,gVal,hVal,iVal,jVal,kVal,lVal]]);
  }

  Logger.log('END updateRewardsNoFormula');
}

function setupDailyTrigger() {
  replaceTrigger_('updateRewardsNoFormula', function(tb) {
    tb.timeBased().everyDays(1).atHour(3).create();
  });
}

function runOnceNow() {
  updateRewardsNoFormula();
}

/**
 * 全期間の報酬を再計算（当月/前月フィルタなし）
 * GASエディタから手動実行する。
 */
function runFullRecalc() {
  updateRewardsNoFormula(true);
}

// ═══════════════════════════════════════════════════
// 報酬管理シートのA・B・C列をGASで管理（数式廃止）
// ═══════════════════════════════════════════════════

/**
 * 報酬管理シートの行構造を維持・拡張する
 * - 既存の年月+名前の行はそのまま保持（D〜L列の値を壊さない）
 * - 作業者マスターに新しい人が追加された場合、該当月のブロックに行を追加
 * - 当月分が存在しなければ新しい月ブロックを追加
 *
 * 毎日cronDaily3で報酬計算前に実行、または手動で実行
 */
function syncRewardRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shR = ss.getSheetByName('報酬管理');
  var shM = ss.getSheetByName('作業者マスター');
  if (!shR || !shM) return;

  var START_YEAR = 2025, START_MONTH = 6; // 報酬管理の起点: 2025年6月

  function pad2(n) { return ('0' + n).slice(-2); }
  function norm(s) { return String(s || '').replace(/\u3000/g, ' ').trim(); }

  // 作業者マスターから現在の作業者リスト＋メールを取得
  var lastRowM = shM.getLastRow();
  var nM = Math.max(0, lastRowM - 1);
  if (nM === 0) return;
  var masterData = shM.getRange(2, 2, nM, 3).getValues(); // B:名前, C:?, D:メール
  var workers = [];
  var emailMap = {};
  for (var i = 0; i < masterData.length; i++) {
    var name = norm(masterData[i][0]);
    if (!name) continue;
    workers.push(name);
    emailMap[name] = norm(masterData[i][2]); // D列（B+3列目-1=index2）
  }
  if (workers.length === 0) return;

  // 報酬管理シートの既存データを読み込み
  var startRow = 3;
  var lastRowR = shR.getLastRow();
  var existingMonths = {}; // { 'YYYY/MM': { '名前': rowIndex, ... } }
  var allMonthKeys = [];

  if (lastRowR >= startRow) {
    // A〜C列の値を一括読み取り
    var totalRows = lastRowR - startRow + 1;
    var abcVals = shR.getRange(startRow, 1, totalRows, 3).getDisplayValues();

    // 実データのある最終行を特定（数式が空文字を返す行を除外）
    var dataLastIdx = -1;
    for (var r = totalRows - 1; r >= 0; r--) {
      if (norm(abcVals[r][0]) || norm(abcVals[r][1])) { dataLastIdx = r; break; }
    }

    // 数式→値に一括変換（データがある範囲のみ）
    if (dataLastIdx >= 0) {
      var dataRows = dataLastIdx + 1;
      var displayVals = [];
      for (var r = 0; r < dataRows; r++) {
        displayVals.push([abcVals[r][0], abcVals[r][1], abcVals[r][2]]);
      }
      shR.getRange(startRow, 1, dataRows, 1).setNumberFormat('@'); // A列をテキスト形式に
      shR.getRange(startRow, 1, dataRows, 3).setValues(displayVals);
      // M列も値に変換
      var mDisplay = shR.getRange(startRow, 13, dataRows, 1).getDisplayValues();
      var mVals = [];
      for (var r = 0; r < dataRows; r++) {
        mVals.push([mDisplay[r][0] === '' ? '' : Number(mDisplay[r][0]) || 0]);
      }
      shR.getRange(startRow, 13, dataRows, 1).setValues(mVals);
      Logger.log('A〜C列 + M列を値に変換: %s行', dataRows);

      // データがない余分な行（数式だけの空行）を一括削除
      var excessRows = totalRows - dataRows;
      if (excessRows > 0) {
        shR.deleteRows(startRow + dataRows, excessRows);
        Logger.log('空の数式行を %s 行一括削除', excessRows);
      }
      lastRowR = shR.getLastRow();
      // abcValsをデータ範囲に切り詰め
      abcVals = abcVals.slice(0, dataRows);
    }

    // 当月を確定（未来データ除外の基準）
    var today = new Date();
    var curYM = today.getFullYear() + '/' + pad2(today.getMonth() + 1);

    // 既存データのマッピング構築（未来の行は削除）
    var futureRows = []; // 未来月の行番号（削除対象）
    for (var i = 0; i < abcVals.length; i++) {
      var ym = norm(abcVals[i][0]);
      var name = norm(abcVals[i][1]);
      if (!ym || !name) continue;
      if (!ym.match(/^\d{4}\/\d{2}$/)) continue;
      if (ym > curYM) {
        futureRows.push(startRow + i);
        continue;
      }
      if (!existingMonths[ym]) {
        existingMonths[ym] = {};
        allMonthKeys.push(ym);
      }
      existingMonths[ym][name] = startRow + i;
    }

    // 未来の行を一括削除（連続範囲でまとめて削除）
    if (futureRows.length > 0) {
      futureRows.sort(function(a, b) { return a - b; });
      // 連続する行をグループ化して一括deleteRows
      var groups = [];
      var gStart = futureRows[0], gEnd = futureRows[0];
      for (var f = 1; f < futureRows.length; f++) {
        if (futureRows[f] === gEnd + 1) {
          gEnd = futureRows[f];
        } else {
          groups.push({start: gStart, count: gEnd - gStart + 1});
          gStart = futureRows[f]; gEnd = futureRows[f];
        }
      }
      groups.push({start: gStart, count: gEnd - gStart + 1});
      // 下のグループから削除（インデックスずれ防止）
      for (var g = groups.length - 1; g >= 0; g--) {
        shR.deleteRows(groups[g].start, groups[g].count);
      }
      lastRowR = shR.getLastRow();
      Logger.log('未来の行を %s 行削除（%sグループ）', futureRows.length, groups.length);
    }
  }

  // 起点月〜当月の全月を確保（シートが空でも全月生成）
  var sy = START_YEAR, sm = START_MONTH;
  var cy = today.getFullYear(), cm = today.getMonth() + 1;
  while (sy < cy || (sy === cy && sm <= cm)) {
    var genYM = sy + '/' + pad2(sm);
    if (!existingMonths[genYM]) {
      existingMonths[genYM] = {};
      allMonthKeys.push(genYM);
    }
    sm++;
    if (sm > 12) { sm = 1; sy++; }
  }

  // 各月について、不足している作業者の行を追加
  var rowsToAppend = [];
  allMonthKeys.sort();

  for (var m = 0; m < allMonthKeys.length; m++) {
    var ym = allMonthKeys[m];
    var monthWorkers = existingMonths[ym];
    for (var w = 0; w < workers.length; w++) {
      if (!monthWorkers[workers[w]]) {
        rowsToAppend.push([ym, workers[w], emailMap[workers[w]] || '']);
      }
    }
  }

  if (rowsToAppend.length > 0) {
    // 報酬管理シートの最終行の後に一括追加
    var appendRow = Math.max(lastRowR + 1, startRow);
    // A列をテキスト形式に設定（日付自動変換を防止）
    shR.getRange(appendRow, 1, rowsToAppend.length, 1).setNumberFormat('@');
    shR.getRange(appendRow, 1, rowsToAppend.length, 3).setValues(rowsToAppend);
    Logger.log('報酬管理に %s 行追加', rowsToAppend.length);

    // A列（年月）でソート → 同じ月の作業者がまとまるように
    var totalRows = Math.max(lastRowR, appendRow + rowsToAppend.length - 1) - startRow + 1;
    var sortRange = shR.getRange(startRow, 1, totalRows, shR.getLastColumn());
    sortRange.sort([{column: 1, ascending: true}, {column: 2, ascending: true}]);
    Logger.log('報酬管理をA列→B列でソート完了');
  } else {
    Logger.log('追加行なし（全作業者の行が存在）');
  }

  // C列（メール）＋ M列（月ブロック奇偶）を最新で更新
  lastRowR = shR.getLastRow();
  if (lastRowR >= startRow) {
    var abVals2 = shR.getRange(startRow, 1, lastRowR - startRow + 1, 2).getValues();
    var cUpdates = [];
    var mUpdates = [];
    // 月→連番インデックスを構築（ソート後の順序で奇偶判定）
    var monthOrder = {};
    var monthIdx = 0;
    var prevYm = '';
    for (var i = 0; i < abVals2.length; i++) {
      var ym = norm(abVals2[i][0]);
      var nm = norm(abVals2[i][1]);
      if (ym && ym !== prevYm) {
        monthOrder[ym] = monthIdx;
        monthIdx++;
        prevYm = ym;
      }
      cUpdates.push([emailMap[nm] || '']);
      mUpdates.push([ym ? (monthOrder[ym] % 2) : '']);
    }
    shR.getRange(startRow, 3, cUpdates.length, 1).setValues(cUpdates);
    shR.getRange(startRow, 13, mUpdates.length, 1).setValues(mUpdates);
  }

  Logger.log('syncRewardRows 完了');
}

/**
 * 初回移行: 数式→値変換 ＋ 不足行追加 ＋ 全期間報酬再計算
 * GASエディタから1回だけ手動実行する
 */
function migrateRewardSheet() {
  syncRewardRows();
  updateRewardsNoFormula(true);
  Logger.log('migrateRewardSheet 完了: 数式→値変換 → 行構造修正 → 全期間報酬再計算');
}
