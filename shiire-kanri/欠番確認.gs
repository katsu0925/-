// 欠番確認.gs
function 出力_欠番確認() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName("商品管理");
  if (!src) return;
  var lastRow = src.getLastRow();
  if (lastRow < 2) return;
  var vals = src.getRange(2, 6, lastRow - 1, 1).getValues().flat().filter(function(v){return v && String(v).trim() !== "";});
  var groups = {};
  vals.forEach(function(v){
    var s = String(v).trim();
    var m = s.match(/^([^\d]+)(\d+)$/);
    if (!m) return;
    var p = m[1]; var n = parseInt(m[2], 10);
    if (!groups[p]) groups[p] = [];
    groups[p].push(n);
  });
  var prefixes = Object.keys(groups).sort();
  var out = [];
  prefixes.forEach(function(p){
    var nums = Array.from(new Set(groups[p])).sort(function(a,b){return a-b;});
    if (nums.length === 0) { out.push([p, "欠番なし", 0]); return; }
    var min = nums[0]; var max = nums[nums.length - 1];
    var set = new Set(nums);
    var miss = [];
    for (var i = min; i <= max; i++) { if (!set.has(i)) miss.push(i); }
    var keep = [];
    if (miss.length > 0) {
      var run = [miss[0]];
      for (var k = 1; k < miss.length; k++) {
        if (miss[k] === miss[k-1] + 1) { run.push(miss[k]); }
        else { if (run.length <= 2) keep = keep.concat(run); run = [miss[k]]; }
      }
      if (run.length <= 2) keep = keep.concat(run);
    }
    if (keep.length === 0) { out.push([p, "欠番なし", 0]); }
    else { out.push([p, keep.map(function(n){return p + n;}).join(", "), keep.length]); }
  });
  var dst = ss.getSheetByName("欠番確認") || ss.insertSheet("欠番確認");
  dst.clear();
  dst.getRange(1,1,1,3).setValues([["プレフィックス","欠番（1～2だけの抜け）","件数"]]);
  if (out.length > 0) dst.getRange(2,1,out.length,3).setValues(out);
}
