// 棚卸し.gs
const SHEET_PURCHASE = '仕入れ管理';
const SHEET_STOCK = '棚卸明細';
const SHEET_PRODUCT = '商品管理';
const SHEET_LOG = '棚卸ログ';
const LOG_ENABLED = true;
const BUSY_KEY = 'INV_BUSY';

function handleChange_Inventory(e){
  const props = PropertiesService.getScriptProperties();
  if(props.getProperty(BUSY_KEY)==='1'){
    const busyAt = props.getProperty(BUSY_KEY + '_AT');
    if(!busyAt || (Date.now() - Number(busyAt)) <= 5 * 60 * 1000) return;
    props.deleteProperty(BUSY_KEY);
    props.deleteProperty(BUSY_KEY + '_AT');
    log_('handleChange_Inventory: BUSY_KEY stale, cleared');
  }
  try{
    props.setProperty(BUSY_KEY,'1');
    props.setProperty(BUSY_KEY + '_AT', String(Date.now()));
    syncCurrentMonthIds();
    recomputeComputedColumns();
  }catch(err){
    log_('handleChange_Inventory ERR: '+err);
  }finally{
    props.deleteProperty(BUSY_KEY);
    props.deleteProperty(BUSY_KEY + '_AT');
  }
}

function showStartMonthDatePicker(){
  const html = HtmlService.createHtmlOutput(
`<div style="font-family:system-ui,Segoe UI,Roboto,Arial;padding:16px 18px;min-width:320px;">
  <h3 style="margin:0 0 12px;">棚卸し日を選択</h3>
  <input id="d" type="date" style="font-size:14px;padding:6px 8px;">
  <div id="status" style="margin-top:10px;color:#6b7280;"></div>
  <div style="margin-top:14px;display:flex;gap:8px;">
    <button id="ok" onclick="submitDate()" style="padding:6px 12px;">開始する</button>
    <button id="cancel" onclick="google.script.host.close()" style="padding:6px 12px;">キャンセル</button>
  </div>
  <script>
    (function(){
      const now=new Date();const end=new Date(now.getFullYear(),now.getMonth()+1,0);
      document.getElementById('d').value=end.getFullYear()+'-'+('0'+(end.getMonth()+1)).slice(-2)+'-'+('0'+end.getDate()).slice(-2);
    })();
    function setBusy(b,msg){document.getElementById('ok').disabled=b;document.getElementById('cancel').disabled=b;document.getElementById('status').textContent=msg||'';}
    function submitDate(){
      const v=document.getElementById('d').value;
      if(!v){alert('日付を選択してください');return;}
      setBusy(true,'入力中…（数秒かかることがあります）');
      google.script.run
        .withSuccessHandler(function(){setBusy(false,'完了しました');setTimeout(function(){google.script.host.close()},800)})
        .withFailureHandler(function(err){setBusy(false,'エラー: '+(err&&err.message?err.message:err))})
        .startNewMonthFromISO(v);
    }
  </script>
</div>`
  ).setWidth(380).setHeight(230);
  SpreadsheetApp.getUi().showModalDialog(html, '今月を開始');
}

function startNewMonth(){ showStartMonthDatePicker(); }

function startNewMonthFromISO(iso){
  const d=parseISODate(iso);
  if(!d) throw new Error('日付形式が不正です');
  startNewMonthInternal(d);
}

function startNewMonthInternal(newDate){
  const props = PropertiesService.getScriptProperties();
  if(props.getProperty(BUSY_KEY)==='1'){
    // 5分以上前にセットされたBUSY_KEYはスタックとみなしてクリア
    const busyAt = props.getProperty(BUSY_KEY + '_AT');
    if(!busyAt || (Date.now() - Number(busyAt)) > 5 * 60 * 1000){
      // _ATなし(旧形式)または5分以上経過 → スタックとみなしクリア
      props.deleteProperty(BUSY_KEY);
      props.deleteProperty(BUSY_KEY + '_AT');
      log_('startNewMonth: BUSY_KEY stale, cleared');
    } else {
      throw new Error('別の処理が実行中です。しばらく待ってから再度お試しください。');
    }
  }
  props.setProperty(BUSY_KEY,'1');
  props.setProperty(BUSY_KEY + '_AT', String(Date.now()));

  const ss=SpreadsheetApp.getActive();
  const shStock=ss.getSheetByName(SHEET_STOCK);
  if(!shStock) throw new Error('シート「'+SHEET_STOCK+'」が見つかりません');

  try{
    // 同じ棚卸日のブロックを二重に作らない（2026/02/28 で実際に1件の重複行が発生している）
    if(getBlockRowsByDate(newDate).length>0){
      throw new Error(toYMD(normalizeDate(newDate))+' の棚卸ブロックは既に存在します');
    }

    const pm=getPurchaseMap();
    const pMap=pm.map;
    const outflowMap=buildOutflowCountMap();
    const adjMap=buildAdjustMap_(shStock,newDate);

    // 旧実装は「前月の実地棚卸数(D列)をそのまま今月の理論在庫(C列)に引き継ぐ」だったため、
    // 当月に売れた分が一切反映されず、一度書かれた数字が永久に減らなかった。
    // 毎月 calcTheory で引き直す（実地棚卸で出た差異は adjMap 側で引き継がれる）。
    const rows=[];
    for(let i=0;i<pm.orderedIds.length;i++){
      const id=pm.orderedIds[i];
      rows.push([newDate,id,Number(calcTheory(id,pMap,outflowMap,adjMap))||0,'','','','']);
    }
    if(rows.length===0){ log_('startNewMonth: rows=0'); throw new Error('仕入れ管理シートに対象データがありません'); }

    const startRow = findFirstEmptyRowAtoG(shStock,3);
    ensureRows_(shStock, startRow + rows.length - 1);

    log_('startNewMonth startRow='+startRow+' writeRows='+rows.length+' firstId='+(rows[0] ? rows[0][1] : ''));

    shStock.getRange(startRow,1,rows.length,7).setValues(rows);
    SpreadsheetApp.flush();

    const b3 = String(shStock.getRange(3,2).getValue()).trim();
    const a3 = shStock.getRange(3,1).getValue();
    if(startRow===3 && b3===''){
      log_('row3 empty after write → force rewrite row3 with '+rows[0][1]);
      shStock.getRange(3,1,1,7).setValues([[a3||newDate, rows[0][1], rows[0][2], '', '', '', '']]);
      SpreadsheetApp.flush();
      log_('row3 now='+String(shStock.getRange(3,2).getValue()).trim());
    }

    shStock.activate();
    shStock.setActiveRange(shStock.getRange(startRow,1,1,1));

    recomputeComputedColumns();
  }catch(err){
    log_('startNewMonth ERR: '+err);
    throw err;
  }finally{
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT');
  }
}

function syncCurrentMonthIds(){
  const props = PropertiesService.getScriptProperties();
  if(props.getProperty(BUSY_KEY)==='1'){
    const busyAt = props.getProperty(BUSY_KEY + '_AT');
    if(busyAt && (Date.now() - Number(busyAt)) > 5 * 60 * 1000){
      props.deleteProperty(BUSY_KEY);
      props.deleteProperty(BUSY_KEY + '_AT');
      log_('syncCurrentMonthIds: BUSY_KEY stale, cleared');
    } else { return; }
  }
  props.setProperty(BUSY_KEY,'1');
  props.setProperty(BUSY_KEY + '_AT', String(Date.now()));

  const ss=SpreadsheetApp.getActive();
  const shStock=ss.getSheetByName(SHEET_STOCK);
  if(!shStock){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT'); return; }

  const lastDate=getLatestStockDate();
  if(!lastDate){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT'); return; }

  try{
    const pm=getPurchaseMap();
    const pMap=pm.map;
    const outflowMap=buildOutflowCountMap();
    const adjMap=buildAdjustMap_(shStock,lastDate);

    const block=getBlockRowsByDate(lastDate);
    const currentIds=new Set();

    if(block.length>0){
      const lr=shStock.getLastRow();
      if(lr>=3){
        const b=shStock.getRange(3,2,lr-2,1).getValues();
        for(let i=0;i<block.length;i++){
          const idx=block[i]-3;
          if(idx<0 || idx>=b.length) continue;
          const v=String(b[idx][0]||'').trim();
          if(v) currentIds.add(v);
        }
      }
    }

    const addIds=pm.orderedIds.filter(id=>!currentIds.has(id));
    if(addIds.length===0){ log_('sync addIds=0'); return; }

    const rows=[];
    for(let i=0;i<addIds.length;i++){
      const id=addIds[i];
      const theory=calcTheory(id,pMap,outflowMap,adjMap);
      rows.push([lastDate,id,Number(theory)||0,'','','','']);
    }

    const startRow=findFirstEmptyRowAtoG(shStock,3);
    ensureRows_(shStock, startRow + rows.length - 1);

    log_('syncCurrentMonthIds startRow='+startRow+' writeRows='+rows.length+' firstId='+(rows[0] ? rows[0][1] : ''));

    shStock.getRange(startRow,1,rows.length,7).setValues(rows);
    SpreadsheetApp.flush();

    if(startRow===3 && String(shStock.getRange(3,2).getValue()).trim()===''){
      const first=rows[0];
      shStock.getRange(3,1,1,7).setValues([[first[0],first[1],first[2],'','','','']]);
      SpreadsheetApp.flush();
    }

    recomputeComputedColumns();
  }catch(err){
    log_('syncCurrentMonthIds ERR: '+err);
    throw err;
  }finally{
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT');
  }
}

// ⚠️ 旧運用の名残。C列は recomputeComputedColumns() が毎回 calcTheory で引き直すため、
// この関数を実行しても末尾の recomputeComputedColumns() で上書きされる。どこからも呼ばれていない。
function recalcCurrentTheoryFromPrev(){
  const props = PropertiesService.getScriptProperties();
  if(props.getProperty(BUSY_KEY)==='1'){
    const busyAt = props.getProperty(BUSY_KEY + '_AT');
    if(busyAt && (Date.now() - Number(busyAt)) > 5 * 60 * 1000){
      props.deleteProperty(BUSY_KEY);
      props.deleteProperty(BUSY_KEY + '_AT');
      log_('recalcCurrentTheoryFromPrev: BUSY_KEY stale, cleared');
    } else { return; }
  }
  props.setProperty(BUSY_KEY,'1');
  props.setProperty(BUSY_KEY + '_AT', String(Date.now()));

  const ss=SpreadsheetApp.getActive();
  const shStock=ss.getSheetByName(SHEET_STOCK);
  if(!shStock){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT'); return; }

  const lastDate=getLatestStockDate();
  if(!lastDate){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT'); return; }

  const prevDate=getPrevMonthDate(lastDate);
  if(!prevDate){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT'); return; }

  try{
    const curBlock=getBlockRowsByDate(lastDate);
    const prevBlock=getBlockRowsByDate(prevDate);
    if(curBlock.length===0||prevBlock.length===0) return;

    const lr=shStock.getLastRow();
    if(lr<3) return;

    const bd=shStock.getRange(3,2,lr-2,3).getValues();

    const prevMap=new Map();
    for(let i=0;i<prevBlock.length;i++){
      const idx=prevBlock[i]-3;
      if(idx<0 || idx>=bd.length) continue;
      const id=String(bd[idx][0]||'').trim();
      const dVal=bd[idx][2];
      if(!id) continue;
      if(dVal===''||dVal==null) continue;
      const dNum=Number(dVal);
      if(isNaN(dNum)) continue;
      prevMap.set(id,Number(dNum)||0);
    }

    const cVals=[];
    for(let i=0;i<curBlock.length;i++){
      const idx=curBlock[i]-3;
      if(idx<0 || idx>=bd.length){ cVals.push(['']); continue; }
      const id=String(bd[idx][0]||'').trim();
      if(!id){ cVals.push(['']); continue; }
      const v=prevMap.has(id)?prevMap.get(id):'';
      cVals.push([v!==''?Number(v)||0:'']);
    }

    shStock.getRange(curBlock[0],3,curBlock.length,1).setValues(cVals);
    SpreadsheetApp.flush();

    recomputeComputedColumns();
  }catch(err){
    log_('recalcCurrentTheoryFromPrev ERR: '+err);
    throw err;
  }finally{
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY + '_AT');
  }
}

function getPurchaseMap(){
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_PURCHASE);
  if(!sh) return {ids:[],orderedIds:[],map:new Map()};
  const lr=sh.getLastRow();
  if(lr<2) return {ids:[],orderedIds:[],map:new Map()};
  const raw=sh.getRange(2,1,lr-1,8).getValues();
  const list=[];
  for(let i=0;i<raw.length;i++){
    const row=raw[i];
    const id=String(row[0]||'').trim();
    if(id==='') continue;
    list.push({row:2+i,id,qty:Number(row[5])||0,cost:Number(row[7])||0,date:row[1]});
  }
  const seen=new Set();
  const ordered=list.filter(o=>{ if(seen.has(o.id)) return false; seen.add(o.id); return true; }).sort((a,b)=>a.row-b.row);
  const map=new Map();
  ordered.forEach(o=>map.set(o.id,{qty:o.qty,cost:o.cost,date:o.date,row:o.row}));
  const orderedIds=ordered.map(o=>o.id);
  return {ids:[...new Set(orderedIds)],orderedIds,map};
}

// 在庫から抜けたとみなすステータス。
// 「返品済み」は含めない — メルカリから引き上げてデタウリ卸に回しただけで現物は手元にある。
const OUTFLOW_STATUSES=['売却済み','発送済み','キャンセル','廃棄済み'];

// 仕入れIDごとの出庫点数を数える。
// 旧実装は 販売日/返品日付/キャンセル日/廃棄日 の「日付列が埋まっているか」で数えていたため、
// 販売日が空のまま売却済みになっている商品（AppSheet時代の移行分・約1,800点）を1点も引けず、
// さらに返品済み（＝手元にある在庫）を出庫として数える誤りもあった。
// ステータスで数えれば日付欠落の影響を受けない。
function buildOutflowCountMap(){
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_PRODUCT);
  if(!sh) return new Map();
  const lr=sh.getLastRow();
  if(lr<2) return new Map();
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(v=>String(v||'').trim());
  const idCol=headers.indexOf('仕入れID');
  const stCol=headers.indexOf('ステータス');
  if(idCol<0||stCol<0){
    log_('buildOutflowCountMap: 列が見つかりません 仕入れID='+idCol+' ステータス='+stCol);
    throw new Error('商品管理シートに「仕入れID」または「ステータス」列がありません');
  }
  const ids=sh.getRange(2,idCol+1,lr-1,1).getValues().flat();
  const sts=sh.getRange(2,stCol+1,lr-1,1).getValues().flat();
  const m=new Map();
  for(let i=0;i<ids.length;i++){
    const id=String(ids[i]||'').trim();
    if(!id) continue;
    if(OUTFLOW_STATUSES.indexOf(String(sts[i]||'').trim())<0) continue;
    m.set(id,(m.get(id)||0)+1);
  }
  return m;
}

// 理論在庫 = 仕入れ点数 − 出庫点数 + 実地棚卸で確定した過去の差異（累計）
function calcTheory(id,pMap,outflowMap,adjMap){
  const p=pMap.get(id);
  const base=p?p.qty:0;
  const out=outflowMap.get(id)||0;
  const adj=(adjMap&&adjMap.get(id))||0;
  return base-out+adj;
}

// 過去ブロック（excludeDate の棚卸日は除く）のE列＝実地−理論の差異を仕入れIDごとに累計する。
// 実地棚卸で見つかった差異（紛失・数え漏れ）を翌月以降の理論在庫へ引き継ぐため。
// 差異が一度も出ていなければ全て0なので、理論在庫は 仕入れ点数−出庫点数 そのものになる。
function buildAdjustMap_(shStock,excludeDate){
  const m=new Map();
  if(!shStock) return m;
  const lr=shStock.getLastRow();
  if(lr<3) return m;
  const vals=shStock.getRange(3,1,lr-2,5).getValues();
  const exYmd=excludeDate?toYMD(normalizeDate(excludeDate)):null;
  for(let i=0;i<vals.length;i++){
    const d=vals[i][0];
    if(!d) continue;
    const dt=new Date(d);
    if(isNaN(dt.getTime())) continue;
    if(exYmd && toYMD(normalizeDate(dt))===exYmd) continue;
    const id=String(vals[i][1]||'').trim();
    if(!id) continue;
    const e=vals[i][4];
    if(e===''||e==null) continue;
    const n=Number(e);
    if(isNaN(n)||n===0) continue;
    m.set(id,(m.get(id)||0)+n);
  }
  return m;
}

function getLatestStockDate(){
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_STOCK);
  if(!sh) return null;
  const lr=sh.getLastRow();
  if(lr<3) return null;
  const vals=sh.getRange(3,1,lr-2,1).getValues().flat().filter(v=>v);
  if(vals.length===0) return null;
  const ds=vals.map(v=>normalizeDate(new Date(v)));
  ds.sort((a,b)=>a-b);
  return ds[ds.length-1];
}

function getPrevMonthDate(d){
  if(!d) return null;
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_STOCK);
  if(!sh) return null;
  const lr=sh.getLastRow();
  if(lr<3) return null;
  const vals=sh.getRange(3,1,lr-2,1).getValues().flat();
  const set=new Set(vals.filter(v=>v).map(v=>toYMD(normalizeDate(new Date(v)))));
  const cand=[new Date(d.getFullYear(),d.getMonth()-1,1),new Date(d.getFullYear(),d.getMonth()-1,15),new Date(d.getFullYear(),d.getMonth(),0)];
  for(const c of cand){const ymd=toYMD(normalizeDate(c));if(set.has(ymd))return normalizeDate(c)}
  const arr=[...set].map(s=>parseYMD(s)).filter(x=>x).sort((a,b)=>a-b);
  if(arr.length===0) return null;
  const idx=arr.findIndex(x=>toYMD(x)===toYMD(normalizeDate(d)));
  if(idx>0) return arr[idx-1];
  if(arr.length>=1 && arr[0] < d) return arr[arr.length-1];
  return null;
}

function getBlockRowsByDate(dateObj){
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_STOCK);
  if(!sh) return [];
  const lr=sh.getLastRow();
  if(lr<3) return [];
  const ymd=toYMD(normalizeDate(dateObj));
  const vals=sh.getRange(3,1,lr-2,1).getValues();
  const rows=[];
  for(let i=0;i<vals.length;i++){
    const v=vals[i][0];
    if(!v) continue;
    if(toYMD(normalizeDate(new Date(v)))===ymd) rows.push(3+i);
  }
  return rows;
}

// 最新ブロックの C(理論在庫)・E(差異)・F(商品原価)・G(棚卸金額) を計算し直す。
// C を毎回引き直すのがこの関数の要 — 旧実装は C を一切更新しなかったため、
// 行が作られた月の数字のまま固定され、その後どれだけ売れても棚卸数が減らなかった。
function recomputeComputedColumns(){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName(SHEET_STOCK);
  if(!sh) return;

  const lastDate=getLatestStockDate();
  if(!lastDate) return;

  const rows=getBlockRowsByDate(lastDate);
  if(rows.length===0) return;

  // C・D列まで書き換えるので、ブロックの行が連続していない場合は触らない（範囲書き込みでズレるため）
  if(rows[rows.length-1]-rows[0]+1!==rows.length){
    log_('recomputeComputedColumns: 最新ブロックの行が連続していません（'+rows[0]+'〜'+rows[rows.length-1]+' / '+rows.length+'行）。中止');
    return;
  }

  const pMap=getPurchaseMap().map;
  const outflowMap=buildOutflowCountMap();
  const adjMap=buildAdjustMap_(sh,lastDate);

  const bVals=sh.getRange(rows[0],2,rows.length,1).getValues().flat();
  const cVals=sh.getRange(rows[0],3,rows.length,1).getValues().flat();
  const dVals=sh.getRange(rows[0],4,rows.length,1).getValues().flat();

  const cOut=[];const dOut=[];const eOut=[];const fOut=[];const gOut=[];
  let dSynced=0;
  for(let i=0;i<rows.length;i++){
    const id=String(bVals[i]||'').trim();
    if(!id){cOut.push([cVals[i]]);dOut.push([dVals[i]]);eOut.push(['']);fOut.push(['']);gOut.push(['']);continue;}

    const cOldRaw=cVals[i];
    const cOld=(cOldRaw===''||cOldRaw==null)?NaN:Number(cOldRaw);
    const cNum=calcTheory(id,pMap,outflowMap,adjMap);

    // D列(実地棚卸数)は、実地カウントされていない行だけ新しい理論値に追従させる。
    // 「実地カウントされていない」＝ D が旧C と同値。実際に数えて別の値が入っている行と、
    // まだ空の行には絶対に触らない。
    let dRaw=dVals[i];
    const hadD=!(dRaw===''||dRaw==null);
    if(hadD && !isNaN(cOld) && Number(dRaw)===cOld && cNum!==cOld){ dRaw=cNum; dSynced++; }

    const hasD=!(dRaw===''||dRaw==null);
    const dNum=hasD?Number(dRaw):NaN;

    const p=pMap.get(id);
    const cost=(p&&!isNaN(Number(p.cost)))?Number(p.cost):'';

    const eVal=(!hasD || isNaN(dNum)) ? '' : (dNum-cNum);
    const fVal=(cost===''||cost==null||isNaN(Number(cost))) ? '' : Number(cost);
    const gVal=(!hasD || fVal==='' || isNaN(dNum)) ? '' : (dNum*fVal);

    cOut.push([cNum]);
    dOut.push([hasD?dRaw:'']);
    eOut.push([eVal]);
    fOut.push([fVal]);
    gOut.push([gVal]);
  }

  sh.getRange(rows[0],3,rows.length,1).setValues(cOut);
  sh.getRange(rows[0],4,rows.length,1).setValues(dOut);
  sh.getRange(rows[0],5,rows.length,1).setValues(eOut);
  sh.getRange(rows[0],6,rows.length,1).setValues(fOut);
  sh.getRange(rows[0],7,rows.length,1).setValues(gOut);
  if(dSynced) log_('recomputeComputedColumns: 実地未カウント行のD列を理論値に更新 '+dSynced+'件 / '+rows.length+'行');
}

function findFirstEmptyRowAtoG(sh,fromRow){
  const max=sh.getMaxRows();
  const last=Math.max(sh.getLastRow(), fromRow-1);
  const scanTo=Math.min(max, last+200);
  const num=scanTo-fromRow+1;
  if(num<=0) return last+1;

  const displays=sh.getRange(fromRow,1,num,7).getDisplayValues();
  for(let i=0;i<displays.length;i++){
    const row=displays[i];
    let empty=true;
    for(let j=0;j<7;j++){
      if(String(row[j]||'').trim()!==''){ empty=false; break; }
    }
    if(empty) return fromRow+i;
  }
  return scanTo+1;
}

function ensureRows_(sh, requiredLastRow){
  const max=sh.getMaxRows();
  if(requiredLastRow<=max) return;
  sh.insertRowsAfter(max, requiredLastRow-max);
}

function openInventoryLog(){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName(SHEET_LOG)||ss.insertSheet(SHEET_LOG);
  if(sh.getLastRow()===0) sh.appendRow(['時刻','処理','備考']);
  ss.setActiveSheet(sh);
}

function clearInventoryLog(){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName(SHEET_LOG);
  if(!sh) return;
  const last=sh.getLastRow();
  if(last>1) sh.getRange(2,1,last-1,3).clearContent();
}

function log_(msg){
  if(!LOG_ENABLED) return;
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName(SHEET_LOG)||ss.insertSheet(SHEET_LOG);
  if(sh.getLastRow()===0) sh.appendRow(['時刻','処理','備考']);
  const now=new Date();
  sh.appendRow([Utilities.formatDate(now,'Asia/Tokyo','yyyy/MM/dd HH:mm:ss'),'棚卸',String(msg)]);
}

function normalizeDate(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
function toYMD(d){const y=d.getFullYear();const m=('0'+(d.getMonth()+1)).slice(-2);const da=('0'+d.getDate()).slice(-2);return y+'-'+m+'-'+da}
function parseYMD(s){const m=s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);if(!m)return null;return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]))}
function parseISODate(iso){const m=iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]))}
