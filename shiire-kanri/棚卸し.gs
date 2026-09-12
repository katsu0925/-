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
    const flowMap=buildOutflowDateMap_();
    const adjMap=buildAdjustMap_(shStock,newDate);
    const newYmd=toYMD(normalizeDate(newDate));

    // 旧実装は「前月の実地棚卸数(D列)をそのまま今月の理論在庫(C列)に引き継ぐ」だったため、
    // 当月に売れた分が一切反映されず、一度書かれた数字が永久に減らなかった。
    // 毎月 calcTheoryAt_ で引き直す（実地棚卸で出た差異は adjMap 側で引き継がれる）。
    const rows=[];
    for(let i=0;i<pm.orderedIds.length;i++){
      const id=pm.orderedIds[i];
      rows.push([newDate,id,Number(calcTheoryAt_(id,pMap,flowMap,adjMap,newYmd))||0,'','','','']);
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
    const flowMap=buildOutflowDateMap_();
    const adjMap=buildAdjustMap_(shStock,lastDate);
    const lastYmd=toYMD(normalizeDate(lastDate));

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
      const theory=calcTheoryAt_(id,pMap,flowMap,adjMap,lastYmd);
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

// ⚠️ 旧運用の名残。C列は recomputeComputedColumns() が毎回 calcTheoryAt_ で引き直すため、
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

// 在庫から抜けたとみなすステータス。StaffApi.gs の STATUS_RULES_ と対で維持すること。
//   廃棄済み(廃棄日) / キャンセル(キャンセル日) / 売却済み(完了日) / 発送済み(発送日付) / 発送待ち(販売日)
// 「発送待ち」は販売日が入った直後＝メルカリで売れた状態なので出庫に数える（現物の発送待ちではない）。
// 「返品済み」は含めない — メルカリから引き上げてデタウリ卸に回しただけで現物は手元にある。
const OUTFLOW_STATUSES=['売却済み','発送済み','発送待ち','キャンセル','廃棄済み'];

// 受付番号から売却日を読む。デタウリ受注の受付番号は2形式ある。
//   20260215233934-223 → 2026-02-15（yyyyMMddHHmmss-連番）
//   260113 / 260209CU  → 2026-01-13 / 2026-02-09（yyMMdd＋任意の英字）
// 16桁hexや「ファスト補填」など日付を持たない値もあるので、その場合は '' を返す。
function receiptToYmd_(v){
  const s=String(v||'').trim();
  if(!s) return '';
  let m=s.match(/^(\d{4})(\d{2})(\d{2})\d{6}/);
  if(m) return m[1]+'-'+m[2]+'-'+m[3];
  m=s.match(/^(\d{2})(\d{2})(\d{2})[A-Za-z]{0,3}$/);
  if(m){
    const mo=Number(m[2]), da=Number(m[3]);
    if(mo>=1&&mo<=12&&da>=1&&da<=31) return '20'+m[1]+'-'+m[2]+'-'+m[3];
  }
  return '';
}

function cellToYmd_(v){
  if(v===''||v==null) return '';
  if(v instanceof Date && !isNaN(v.getTime())) return toYMD(normalizeDate(v));
  const m=String(v).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if(!m) return '';
  return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
}

// 仕入れIDごとに「出庫した日付の配列」と「日付が分からなかった点数」を集める。
// 出庫日の取り方（この順に試す）:
//   1. 廃棄済み→廃棄日 / キャンセル→キャンセル日 / それ以外→販売日
//   2. BO列「受付番号」に埋まっている日付（デタウリ受注はここにしか日付が無い）
//   3. 売却履歴シート（管理番号 → 最も早い売却日）
//   4. 同じ受付番号＝同じ注文の中で判明している最も早い日付
// 2026-09-12 実測でこれで 3,971点中 3,946点（99.4%）の出庫日が確定する。
// 残り25点は受付番号も無く追跡不能なので unknown に積み、常に出庫済みとして扱う。
function buildOutflowDateMap_(){
  const ss=SpreadsheetApp.getActive();
  const sh=ss.getSheetByName(SHEET_PRODUCT);
  const m=new Map();
  if(!sh) return m;
  const lr=sh.getLastRow();
  if(lr<2) return m;

  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(v=>String(v||'').trim());
  const need={仕入れID:0,管理番号:0,ステータス:0,販売日:0,キャンセル日:0,廃棄日:0,受付番号:0};
  const missing=[];
  Object.keys(need).forEach(k=>{ need[k]=headers.indexOf(k); if(need[k]<0) missing.push(k); });
  if(missing.length){
    log_('buildOutflowDateMap_: 商品管理に列がありません '+missing.join(','));
    throw new Error('商品管理シートに次の列がありません: '+missing.join(', '));
  }

  // 売却履歴: 管理番号 → 最も早い売却日
  const logMap=new Map();
  const shLog=ss.getSheetByName('売却履歴');
  if(shLog && shLog.getLastRow()>1){
    const lv=shLog.getRange(2,1,shLog.getLastRow()-1,3).getValues();
    for(let i=0;i<lv.length;i++){
      const k=String(lv[i][1]||'').trim();
      const d=cellToYmd_(lv[i][0]);
      if(!k||!d) continue;
      if(!logMap.has(k)||d<logMap.get(k)) logMap.set(k,d);
    }
  }

  const cols=[need.仕入れID,need.管理番号,need.ステータス,need.販売日,need.キャンセル日,need.廃棄日,need.受付番号];
  const maxCol=Math.max.apply(null,cols)+1;
  const vals=sh.getRange(2,1,lr-1,maxCol).getValues();

  const recs=[];
  for(let i=0;i<vals.length;i++){
    const row=vals[i];
    const sid=String(row[need.仕入れID]||'').trim();
    if(!sid) continue;
    const st=String(row[need.ステータス]||'').trim();
    if(OUTFLOW_STATUSES.indexOf(st)<0) continue;
    const kanri=String(row[need.管理番号]||'').trim();
    const receipt=String(row[need.受付番号]||'').trim();
    let d = st==='廃棄済み' ? cellToYmd_(row[need.廃棄日])
          : st==='キャンセル' ? cellToYmd_(row[need.キャンセル日])
          : cellToYmd_(row[need.販売日]);
    if(!d) d=receiptToYmd_(receipt);
    if(!d && kanri) d=logMap.get(kanri)||'';
    recs.push({sid:sid,receipt:receipt,d:d});
  }

  // 同じ受付番号（＝同じ注文）の中で判明している最も早い日付を、日付不明の行へ流用する
  const byReceipt=new Map();
  for(let i=0;i<recs.length;i++){
    const r=recs[i];
    if(!r.receipt||!r.d) continue;
    if(!byReceipt.has(r.receipt)||r.d<byReceipt.get(r.receipt)) byReceipt.set(r.receipt,r.d);
  }
  let unknownTotal=0;
  for(let i=0;i<recs.length;i++){
    const r=recs[i];
    if(!r.d && r.receipt && byReceipt.has(r.receipt)) r.d=byReceipt.get(r.receipt);
    let e=m.get(r.sid);
    if(!e){ e={dates:[],unknown:0}; m.set(r.sid,e); }
    if(r.d) e.dates.push(r.d); else { e.unknown++; unknownTotal++; }
  }
  m.forEach(e=>e.dates.sort());
  if(unknownTotal) log_('buildOutflowDateMap_: 出庫日が特定できない商品 '+unknownTotal+'点（常に出庫済みとして扱う）');
  return m;
}

// asOfYmd 時点の理論在庫 = 仕入れ点数 − その日までの出庫点数 + 実地棚卸で確定した差異（累計）
// asOfYmd を渡すのが要。旧実装は「今のステータス」だけで数えていたため、棚卸日より後に
// 売れた分まで差し引かれ、同じ棚卸日の数字が日が経つごとに目減りしていた。
function calcTheoryAt_(id,pMap,flowMap,adjMap,asOfYmd){
  const p=pMap.get(id);
  if(!p) return 0;
  const lotYmd=cellToYmd_(p.date);
  if(asOfYmd && lotYmd && lotYmd>asOfYmd) return 0;   // 棚卸日より後に仕入れたロット
  const base=Number(p.qty)||0;
  const f=flowMap?flowMap.get(id):null;
  let out=0;
  if(f){
    out=f.unknown;
    for(let i=0;i<f.dates.length;i++){
      if(!asOfYmd||f.dates[i]<=asOfYmd) out++; else break;
    }
  }
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
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_STOCK);
  if(!sh) return;
  const lastDate=getLatestStockDate();
  if(!lastDate) return;
  const r=recomputeBlock_(sh,lastDate,{pMap:getPurchaseMap().map,flowMap:buildOutflowDateMap_()},false);
  if(r && r.dSynced) log_('recomputeComputedColumns: 実地未カウント行のD列を理論値に更新 '+r.dSynced+'件 / '+r.rows+'行');
}

// ★GASエディタの「実行」ドロップダウン用。棚卸明細の全ブロックを棚卸日基準で引き直す。
//   まずログだけ見る → recomputeAllStockBlocksDryRun
//   実際に書き戻す   → recomputeAllStockBlocksRun
// 過去ブロックも直すので、月次在庫推移（期末棚卸サマリー経由）が全期間で入れ替わる。
function recomputeAllStockBlocksDryRun(){ return recomputeAllStockBlocks(true); }
function recomputeAllStockBlocksRun(){ return recomputeAllStockBlocks(false); }

function recomputeAllStockBlocks(dryRun){
  if(dryRun===undefined) dryRun=true;
  const sh=SpreadsheetApp.getActive().getSheetByName(SHEET_STOCK);
  if(!sh) throw new Error('シート「'+SHEET_STOCK+'」が見つかりません');
  const lr=sh.getLastRow();
  if(lr<3) return {ok:true,blocks:[]};

  const ctx={pMap:getPurchaseMap().map,flowMap:buildOutflowDateMap_()};

  // 棚卸日を昇順に列挙（重複なし）
  const seen={},dates=[];
  const col=sh.getRange(3,1,lr-2,1).getValues();
  for(let i=0;i<col.length;i++){
    const v=col[i][0];
    if(!v) continue;
    const dt=new Date(v);
    if(isNaN(dt.getTime())) continue;
    const ymd=toYMD(normalizeDate(dt));
    if(seen[ymd]) continue;
    seen[ymd]=true; dates.push(normalizeDate(dt));
  }
  dates.sort((x,y)=>x-y);

  const report=[];
  for(let i=0;i<dates.length;i++){
    const r=recomputeBlock_(sh,dates[i],ctx,dryRun);
    if(r) report.push(r);
  }
  Logger.log('recomputeAllStockBlocks'+(dryRun?' [dry-run]':'')+': '+report.length+'ブロック');
  report.forEach(function(r){
    Logger.log('  '+r.ymd+'  '+r.rows+'行  '+r.qtyBefore+'点/¥'+r.amtBefore.toLocaleString()
      +' → '+r.qtyAfter+'点/¥'+r.amtAfter.toLocaleString()
      +'  ('+(r.amtAfter-r.amtBefore>=0?'+':'')+(r.amtAfter-r.amtBefore).toLocaleString()+')');
  });
  if(!dryRun) log_('recomputeAllStockBlocks: '+report.length+'ブロックを引き直しました');
  return {ok:true,dryRun:dryRun,blocks:report};
}

// 1ブロック分を棚卸日基準で引き直す。dryRun なら計算だけしてシートには書かない。
function recomputeBlock_(sh,blockDate,ctx,dryRun){
  const rows=getBlockRowsByDate(blockDate);
  if(rows.length===0) return null;

  // C・D列まで書き換えるので、ブロックの行が連続していない場合は触らない（範囲書き込みでズレるため）
  if(rows[rows.length-1]-rows[0]+1!==rows.length){
    log_('recomputeBlock_: '+toYMD(blockDate)+' の行が連続していません（'+rows[0]+'〜'+rows[rows.length-1]+' / '+rows.length+'行）。中止');
    return null;
  }

  const ymd=toYMD(normalizeDate(blockDate));
  const adjMap=buildAdjustMap_(sh,blockDate);

  const bVals=sh.getRange(rows[0],2,rows.length,1).getValues().flat();
  const cVals=sh.getRange(rows[0],3,rows.length,1).getValues().flat();
  const dVals=sh.getRange(rows[0],4,rows.length,1).getValues().flat();

  const cOut=[];const dOut=[];const eOut=[];const fOut=[];const gOut=[];
  let dSynced=0,qtyBefore=0,amtBefore=0,qtyAfter=0,amtAfter=0;
  const dupSeen={};
  for(let i=0;i<rows.length;i++){
    const id=String(bVals[i]||'').trim();
    if(!id){cOut.push([cVals[i]]);dOut.push([dVals[i]]);eOut.push(['']);fOut.push(['']);gOut.push(['']);continue;}

    const cOldRaw=cVals[i];
    const cOld=(cOldRaw===''||cOldRaw==null)?NaN:Number(cOldRaw);
    // 同じブロックに同じ仕入れIDが二重にある場合、2行目以降は 0 にして二重計上を止める
    const isDup=!!dupSeen[id];
    dupSeen[id]=true;
    const cNum=isDup?0:calcTheoryAt_(id,ctx.pMap,ctx.flowMap,adjMap,ymd);

    // D列(実地棚卸数)は、実地カウントされていない行だけ新しい理論値に追従させる。
    // 「実地カウントされていない」＝ D が旧C と同値。実際に数えて別の値が入っている行と、
    // まだ空の行には絶対に触らない。
    let dRaw=dVals[i];
    const hadD=!(dRaw===''||dRaw==null);
    if(hadD){ qtyBefore+=Number(dRaw)||0; }
    if(hadD && !isNaN(cOld) && Number(dRaw)===cOld && cNum!==cOld){ dRaw=cNum; dSynced++; }

    const hasD=!(dRaw===''||dRaw==null);
    const dNum=hasD?Number(dRaw):NaN;

    const p=ctx.pMap.get(id);
    const cost=(p&&!isNaN(Number(p.cost)))?Number(p.cost):'';

    const eVal=(!hasD || isNaN(dNum)) ? '' : (dNum-cNum);
    const fVal=(cost===''||cost==null||isNaN(Number(cost))) ? '' : Number(cost);
    const gVal=(!hasD || fVal==='' || isNaN(dNum)) ? '' : (dNum*fVal);

    if(hasD){ qtyAfter+=dNum; if(gVal!=='') amtAfter+=gVal; }

    cOut.push([cNum]);
    dOut.push([hasD?dRaw:'']);
    eOut.push([eVal]);
    fOut.push([fVal]);
    gOut.push([gVal]);
  }
  // 変更前の棚卸金額はG列の現在値から取る（点数は上のループでD列の現在値を積んである）
  const gNow=sh.getRange(rows[0],7,rows.length,1).getValues().flat();
  for(let i=0;i<gNow.length;i++) amtBefore+=Number(gNow[i])||0;

  if(!dryRun){
    sh.getRange(rows[0],3,rows.length,1).setValues(cOut);
    sh.getRange(rows[0],4,rows.length,1).setValues(dOut);
    sh.getRange(rows[0],5,rows.length,1).setValues(eOut);
    sh.getRange(rows[0],6,rows.length,1).setValues(fOut);
    sh.getRange(rows[0],7,rows.length,1).setValues(gOut);
  }
  return {ymd:ymd,rows:rows.length,dSynced:dSynced,qtyBefore:qtyBefore,amtBefore:amtBefore,qtyAfter:qtyAfter,amtAfter:amtAfter};
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
