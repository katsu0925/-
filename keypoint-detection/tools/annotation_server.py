#!/usr/bin/env python3
"""
アノテーションツール用サーバー
- annotate.html を配信
- 保存ボタンを押すとJSONが自動的にフォルダに保存される

使い方:
  python3 annotation_server.py
  → http://localhost:8770/annotate.html にアクセス

保存先: annotations_output/ フォルダ
"""

import os
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime

PORT = 8770
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'annotations_output')

os.makedirs(OUTPUT_DIR, exist_ok=True)


class AnnotationHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/count'):
            files = [f for f in os.listdir(OUTPUT_DIR) if f.endswith('.json')]
            total = len(files)
            # ワーカー別集計
            workers = {}
            for f in files:
                try:
                    with open(os.path.join(OUTPUT_DIR, f), 'r') as fh:
                        d = json.load(fh)
                        w = d.get('worker', '不明')
                        workers[w] = workers.get(w, 0) + 1
                except:
                    pass
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'total': total, 'workers': workers}).encode())
            return
        # その他のGETは通常のファイル配信
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/save':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)

            # ファイル名: ワーカー名_元画像名_keypoints.json
            image_name = data.get('image', 'unknown')
            worker = data.get('worker', 'unknown')
            base = os.path.splitext(image_name)[0]
            filename = f'{worker}_{base}_keypoints.json'
            filepath = os.path.join(OUTPUT_DIR, filename)

            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            # 保存済みファイル数をカウント
            count = len([f for f in os.listdir(OUTPUT_DIR) if f.endswith('.json')])

            print(f'  💾 保存: {filename} ({count}件目)')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'ok': True,
                'filename': filename,
                'total': count,
            }).encode())
            return

        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(('0.0.0.0', PORT), AnnotationHandler)
    print(f'=== アノテーションサーバー ===')
    print(f'URL: http://localhost:{PORT}/annotate.html')
    print(f'保存先: {OUTPUT_DIR}')
    print(f'Ctrl+C で停止')
    print()
    server.serve_forever()
