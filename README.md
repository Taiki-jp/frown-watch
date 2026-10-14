# Frown Watch

表情の癖（眉間に力が入る、など）に気づかせるデスクトップ Web の試作。
Chrome の Document Picture-in-Picture で常に最前面の小窓に内カメラと判定結果を出し、
MediaPipe Face Landmarker の blendshape で表情を判定する。動画は一切外部公開されない。

- 公開 URL: https://taiki-jp.github.io/frown-watch/
- リポジトリ: https://github.com/Taiki-jp/frown-watch

## 動かし方

```sh
cd ~/git/frown-watch
python3 -m http.server 8765 --bind 127.0.0.1
```

Chrome で http://localhost:8765/ を開くとトップページ、http://localhost:8765/app.html がアプリ本体。Chrome 116 以降が必要。

## 使い方

初回はセットアップが 5 段階で進む。

1. はじめに: 何をするかの説明と、動作環境の確認
2. カメラ: 内カメラを許可して映りを確認する
3. 基準: 無表情で 3 秒待ち、その顔を「0」にする
4. 通知方法: 音と通知を選び、試しに鳴らす
5. 小窓: 常に最前面の小窓に切り替えて、別タブや別アプリで動画を見る

2 回目からはふだんの画面が開く。「見守りを開始」から「小窓にする」で同じ状態になる。
上部に今日の回数、1 時間あたりの回数、見守った分数が出て、先週との比較と 14 日の推移が並ぶ。
しきい値などの細かい調整は「設定」の中の「詳細設定」、生の値は「詳細（開発者向け）」にある。

アプリ本体の開発用 URL パラメータ: `app.html?autostart` でセットアップを飛ばして開始、`?ob=3` でセットアップの 3 番目を開く、`?open` で折りたたみを全部開く、`?env` で動作環境チェックを実行。

## 言語

日本語と英語に対応。ヘッダーのスイッチで切り替えられ、選んだ言語はブラウザに保存される。初回はブラウザの言語設定で決まる。
URL に `?lang=en` または `?lang=ja` を付けると、その言語で開いて保存する。
文言は `i18n.js` の辞書にまとめてあり、静的な文は HTML の `data-i18n` 属性、動的な文は `t()` で引く。

## 判定の調整

- しきい値: 基準からの増分がこの値を超えたら「力が入っている」とみなす。「今の値」を見ながら決める
- 継続: この秒数続いたら 1 回と数え、枠を赤くする
- 休止: 音と通知はこの秒数の間隔をあける。枠の点滅は休止に関係なく続く
- 診断パネル: 判定に使える生の値（blendshape、landmark の距離比、眉間の皮膚の画素）を並べて見られる

## 動画が外部公開されないことの確認方法

このページにはバックエンドがなく、映像も判定結果もどこにも送らない。それを第三者が確かめる手段を 4 つ用意している。

1. 開発者ツールの Network タブを開いたままカメラを開始する。最初の読み込み以外に通信が起きない
2. カメラを開始したあとに Wi-Fi を切っても、そのまま動き続ける
3. `index.html` 冒頭の CSP（Content-Security-Policy）で、配布元以外への通信をブラウザ自身が禁止している。コードが改変されても、ブラウザが外部への送信を拒否する
4. ビルド工程がなく、配布しているファイルがそのまま動く。公開リポジトリと配布物を突き合わせれば、動いているコードが読んだコードと同じだと確認できる

判定ライブラリとモデルは `vendor/` に同梱しており、外部の CDN からは何も読み込まない。
同梱物の取得元と SHA-256 は `vendor/NOTICE.md` にある。

## ファイル構成

- `index.html`: トップページ。アプリの概要と、CSS アニメーションによるデモ。「はじめる」でアプリ本体へ
- `top.js`: トップページのスクリプト。言語の切り替えと、セットアップ済みならボタンの文言を変える
- `i18n.js`: 日本語と英語の辞書と切り替えの仕組み
- `app.html`: アプリ本体の画面と CSP
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
