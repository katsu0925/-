385:const STATUS_OPTIONS = ['採寸待ち','撮影待ち','出品待ち','出品作業中','出品中','売却済み','発送済み','完了','キャンセル','返品','廃棄'];
814:function humanizeApiError_(status, rawMsg) {
1056:var STATUS_RANK = {
1065:function statusRank_(s){ var r = STATUS_RANK[s]; return r != null ? r : 99; }
