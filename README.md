# Frown Watch

表情の癖（眉間に力が入る、など）に気づかせるデスクトップ Web の試作。
Chrome の Document Picture-in-Picture で常に最前面の小窓に内カメラと判定結果を出し、
MediaPipe Face Landmarker の blendshape で表情を判定する。映像は PC の外に出ない。

- 公開 URL: https://taiki-jp.github.io/frown-watch/
- リポジトリ: https://github.com/Taiki-jp/frown-watch

## 動かし方

```sh
cd ~/git/frown-watch
python3 -m http.server 8765 --bind 127.0.0.1
```

Chrome で http://localhost:8765/ を開く。Chrome 116 以降が必要。

## 使い方

1. 「カメラを開始」を押し、カメラを許可する
2. 「無表情の基準を取る」を押し、3 秒間だけ無表情で正面を向く
3. 「小窓にする」で常に最前面の小窓に切り替え、別タブや別アプリで YouTube を見る
4. 眉間に力が入った状態が「継続」の秒数続くと、枠が赤く点滅し、音と通知で知らせる
5. 今日の回数と直近 14 日の推移はページ右下。「CSV をコピー」で持ち出せる

## 判定の調整

- しきい値: 基準からの増分がこの値を超えたら「力が入っている」とみなす。「今の値」を見ながら決める
- 継続: この秒数続いたら 1 回と数え、枠を赤くする
- 休止: 音と通知はこの秒数の間隔をあける。枠の点滅は休止に関係なく続く
- 診断パネル: 判定に使える生の値（blendshape、landmark の距離比、眉間の皮膚の画素）を並べて見られる

## 映像が外に出ないことの確認方法

このページにはバックエンドがなく、映像も判定結果もどこにも送らない。それを第三者が確かめる手段を 4 つ用意している。

1. 開発者ツールの Network タブを開いたままカメラを開始する。最初の読み込み以外に通信が起きない
2. カメラを開始したあとに Wi-Fi を切っても、そのまま動き続ける
3. `index.html` 冒頭の CSP（Content-Security-Policy）で、配布元以外への通信をブラウザ自身が禁止している。コードが改変されても、ブラウザが外部への送信を拒否する
4. ビルド工程がなく、配布しているファイルがそのまま動く。公開リポジトリと配布物を突き合わせれば、動いているコードが読んだコードと同じだと確認できる

判定ライブラリとモデルは `vendor/` に同梱しており、外部の CDN からは何も読み込まない。
同梱物の取得元と SHA-256 は `vendor/NOTICE.md` にある。

## ファイル構成

- `index.html`: 画面と CSP
- `app.js`: 判定と表示のすべて
- `vendor/mediapipe/`: MediaPipe Tasks Vision 1.1.0（Apache-2.0）
- `vendor/models/face_landmarker.task`: 顔 landmark と blendshape のモデル（Apache-2.0）
- `test/`: 判定ロジックと診断値の単体テスト

## 記録の保存先

ブラウザの localStorage のみ。`fw.settings`（設定）、`fw.baseline`（無表情の基準）、`fw.stats`（日次の記録）。

## 公開のしかた（GitHub Pages）

静的ファイルだけなので、リポジトリをそのまま配信すればよい。

```sh
cd ~/git/frown-watch
git init && git add -A && git commit -m "Frown Watch prototype"
gh repo create frown-watch --public --source=. --push
```

その後 GitHub のリポジトリ設定の Pages で、Deploy from a branch を選び、`main` の `/ (root)` を指定する。
数分で `https://<ユーザー名>.github.io/frown-watch/` で開けるようになる。
GitHub Pages は https なので、カメラと小窓の API がそのまま使える。

## テスト

```sh
node test/logic.test.mjs
node test/diag.test.mjs
```
