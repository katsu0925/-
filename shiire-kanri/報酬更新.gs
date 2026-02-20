// 報酬更新.gs
function updateRewardsNoFormula() {
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
    if (idx===curIdx || idx===prevIdx){
      updateRows.push({row:startRow+i,mk:mk,idx:idx,name:name});
      monthsSet[mk]=true;
    }
  }
  if (updateRows.length===0) { Logger.log('No target rows for cur/prev month'); return; }

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
