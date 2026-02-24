// 棚卸し.gs
const SHEET_PURCHASE = '仕入れ管理';
const SHEET_STOCK = '棚卸明細';
const SHEET_PRODUCT = '商品管理';
const SHEET_LOG = '棚卸ログ';
const LOG_ENABLED = true;
const BUSY_KEY = 'INV_BUSY';

function handleChange_Inventory(e){
  if(PropertiesService.getScriptProperties().getProperty(BUSY_KEY)==='1') return;
  try{
    PropertiesService.getScriptProperties().setProperty(BUSY_KEY,'1');
    syncCurrentMonthIds();
    recomputeComputedColumns();
  }catch(err){
    log_('handleChange_Inventory ERR: '+err);
  }finally{
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY);
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
  if(PropertiesService.getScriptProperties().getProperty(BUSY_KEY)==='1') return;
  PropertiesService.getScriptProperties().setProperty(BUSY_KEY,'1');

  const ss=SpreadsheetApp.getActive();
  const shStock=ss.getSheetByName(SHEET_STOCK);
  if(!shStock) throw new Error('シート「'+SHEET_STOCK+'」が見つかりません');

  const lastDate=getLatestStockDate();

  try{
    const pm=getPurchaseMap();
    const pMap=pm.map;
    const outflowMap=buildOutflowCountMap();

    const prevActuals=new Map();

    if(lastDate){
      const lastBlock=getBlockRowsByDate(lastDate);
      if(lastBlock.length>0){
        const lr=shStock.getLastRow();
        if(lr>=3){
          const bd=shStock.getRange(3,2,lr-2,3).getValues();
          for(let i=0;i<lastBlock.length;i++){
            const r=lastBlock[i];
            const idx=r-3;
            if(idx<0 || idx>=bd.length) continue;
            const id=String(bd[idx][0]||'').trim();
            const dVal=bd[idx][2];
            const dNum=(dVal===''||dVal==null)?'':Number(dVal);
            if(id){
              prevActuals.set(id,(dNum===''||isNaN(dNum))?0:(Number(dNum)||0));
            }
          }
        }
      }
    }

    const rows=[];
    for(let i=0;i<pm.orderedIds.length;i++){
      const id=pm.orderedIds[i];
      const theory = prevActuals.has(id) ? prevActuals.get(id) : calcTheory(id,pMap,outflowMap);
      rows.push([newDate,id,Number(theory)||0,'','','','']);
    }
    if(rows.length===0){ log_('startNewMonth: rows=0'); return; }

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
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY);
  }
}

function syncCurrentMonthIds(){
  if(PropertiesService.getScriptProperties().getProperty(BUSY_KEY)==='1') return;
  PropertiesService.getScriptProperties().setProperty(BUSY_KEY,'1');

  const ss=SpreadsheetApp.getActive();
  const shStock=ss.getSheetByName(SHEET_STOCK);
  if(!shStock){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); return; }

  const lastDate=getLatestStockDate();
  if(!lastDate){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); return; }

  try{
    const pm=getPurchaseMap();
    const pMap=pm.map;
    const outflowMap=buildOutflowCountMap();

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
      const theory=calcTheory(id,pMap,outflowMap);
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
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY);
  }
}

function recalcCurrentTheoryFromPrev(){
  if(PropertiesService.getScriptProperties().getProperty(BUSY_KEY)==='1') return;
  PropertiesService.getScriptProperties().setProperty(BUSY_KEY,'1');

  const ss=SpreadsheetApp.getActive();
  const shStock=ss.getSheetByName(SHEET_STOCK);
  if(!shStock){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); return; }

  const lastDate=getLatestStockDate();
  if(!lastDate){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); return; }

  const prevDate=getPrevMonthDate(lastDate);
  if(!prevDate){ PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY); return; }

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
    PropertiesService.getScriptProperties().deleteProperty(BUSY_KEY);
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

function buildOutflowCountMap(){
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_PRODUCT);
  if(!sh) return new Map();
  const lr=sh.getLastRow();
  if(lr<2) return new Map();
  const ids=sh.getRange(2,2,lr-1,1).getValues().flat();
  const ap=sh.getRange(2,42,lr-1,1).getValues().flat();
  const ay=sh.getRange(2,51,lr-1,1).getValues().flat();
  const bh=sh.getRange(2,60,lr-1,1).getValues().flat();
  const bi=sh.getRange(2,61,lr-1,1).getValues().flat();
  const m=new Map();
  for(let i=0;i<ids.length;i++){
    const id=String(ids[i]||'').trim();
    if(!id) continue;
    const c=(ap[i]?1:0)+(ay[i]?1:0)+(bh[i]?1:0)+(bi[i]?1:0);
    m.set(id,(m.get(id)||0)+c);
  }
  return m;
}

function calcTheory(id,pMap,outflowMap){
  const p=pMap.get(id);
  const base=p?p.qty:0;
  const out=outflowMap.get(id)||0;
  return base-out;
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

function recomputeComputedColumns(){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName(SHEET_STOCK);
  if(!sh) return;

  const lastDate=getLatestStockDate();
  if(!lastDate) return;

  const rows=getBlockRowsByDate(lastDate);
  if(rows.length===0) return;

  const pMap=getPurchaseMap().map;

  const bVals=sh.getRange(rows[0],2,rows.length,1).getValues().flat();
  const cVals=sh.getRange(rows[0],3,rows.length,1).getValues().flat();
  const dVals=sh.getRange(rows[0],4,rows.length,1).getValues().flat();

  const eOut=[];const fOut=[];const gOut=[];
  for(let i=0;i<rows.length;i++){
    const id=String(bVals[i]||'').trim();
    if(!id){eOut.push(['']);fOut.push(['']);gOut.push(['']);continue;}

    const cRaw=cVals[i];
    const cNum=(cRaw===''||cRaw==null)?NaN:Number(cRaw);

    const dRaw=dVals[i];
    const hasD=!(dRaw===''||dRaw==null);
    const dNum=hasD?Number(dRaw):NaN;

    const p=pMap.get(id);
    const cost=(p&&!isNaN(Number(p.cost)))?Number(p.cost):'';

    const eVal=(!hasD || isNaN(dNum) || isNaN(cNum)) ? '' : (dNum-cNum);
    const fVal=(cost===''||cost==null||isNaN(Number(cost))) ? '' : Number(cost);
    const gVal=(!hasD || fVal==='' || isNaN(dNum)) ? '' : (dNum*fVal);

    eOut.push([eVal]);
    fOut.push([fVal]);
    gOut.push([gVal]);
  }

  sh.getRange(rows[0],5,rows.length,1).setValues(eOut);
  sh.getRange(rows[0],6,rows.length,1).setValues(fOut);
  sh.getRange(rows[0],7,rows.length,1).setValues(gOut);
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
