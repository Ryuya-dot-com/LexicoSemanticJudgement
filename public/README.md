# 一般向け LJT

公開URL: https://ryuya-dot-com.github.io/LexicoSemanticJudgement/public/

- 160問。Short版と共通する40問の得点だけを既存のShort版換算表に当てはめる。160問の総得点は比例換算しない。
- 練習4問、時間制限なし。音声終了後にF（不適切）/J（適切）または画面ボタンで回答。
- 名前・ID・メールの入力、CSV/JSONのダウンロード、回答の外部送信はない。
- 回答はメモリ内のみ。ページを閉じる・再読み込みすると消去される。ホスティングサービスによる通常のアクセス処理とは区別する。
- 音声エラーは再試行または中断。エラー項目を誤答扱いで先送りしない。未完了時はCEFRを表示しない。
- クレジットは結果画面だけに表示: 小室竜也 (Ryuya Komuro)｜東北大学 PD
- 既存のルートURL、研究用機能、音声原本、オフライン配布物は変更していない。

## 換算の範囲

Short版の `data/conversion.js` を使用。A2/B1/B2の上下位区分は補足表示する。CEFRは既存換算表の参考値であり、公式認定や4技能の評価ではない。Long版は共通40問の音声ファイル名・対象語・正答を照合済みだが、出題順・疲労条件が異なる。Short版単独実施との同等性や、Long版全体としてのCEFR換算妥当性を検証したものではない。

参照元: LJT-S commit `74a9a1c4c216bc34cc817129ad86bfe20de7ea6a`、LexicoSemanticJudgement commit `c8f49c369fc39e439c103a37b9b9e44652a27596`。

## 保守と確認

`app.js` / `styles.css` / `score.js` は両リポジトリで共通。変更時は両版へ反映する。Long版の `conversion.js` はShort版の既存換算表と同期する。`config.js` は既存の問題・正答と音声を参照する。Short版は既存の制約付き乱数化、Long版は既存のFisher–Yatesシャッフルを維持。

```sh
node --test tests/public.test.js
node tests/public-browser-smoke.mjs
```

ブラウザ検査は隔離した一時Chromeプロファイルを使い、音声イベントを模擬して全問完走と異常系を検証する。音声原本の可用性・実ブラウザ再生は別途確認する。

## 2026-11-11 の検証結果

- 両版で8件の問題構成・採点・境界値テスト、既存換算の4件の回帰テストを通過。
- 隔離ChromeでShort 4+40問、Long 4+160問を完走。390px幅の横はみ出し、音声失敗からの再試行・中断、早押し・キーリピート・連打、休憩、結果、再開時のリセットを確認。
- 同テスト中の回答送信・ダウンロード・localStorage/sessionStorage書き込みは0件。
- 元音声208ファイル（Short 44 / Long 164）をffmpegで全件デコードし、エラーなし。
- macOS Chromeで両版の実画面、Short版の音声チェックの再生完了を確認。iPhone / Androidの実機は未確認。
- 研究用ロジック・オフラインZIPは無変更のため、既存の全体検証・ZIP再生成は行っていない。

## 画面と原典（2026-11-11の追加指示）

冒頭は `Lexicosemantic Judgement Test (LJT)`。全体をモノクロにし、解答画面からタイトル・バージョン・クレジット・他版リンク・装飾を除去。結果画面だけにWeb版作成者と下記原典を掲載する。論文は巻号確定後の刊行年（2025）で記載し、オンライン先行公開年（Uchihara: 2024、Saito: 2023）と区別した。

- Uchihara, T., Saito, K., Kurokawa, S., Takizawa, K., & Suzukida, Y. (2025). Declarative and automatized phonological vocabulary knowledge: Recognition, recall, lexicosemantic judgment, and listening-focused employability of second language words. *Language Learning, 75*(2), 458–492. https://doi.org/10.1111/lang.12668
- Saito, K., Uchihara, T., Takizawa, K., & Suzukida, Y. (2025). Individual differences in L2 listening proficiency revisited: Roles of form, meaning, and use aspects of phonological vocabulary knowledge. *Studies in Second Language Acquisition, 47*(1), 26–52. https://doi.org/10.1017/S027226312300044X

原典はLJTの開発・検証に関する文献として示し、このWeb版のCEFR換算の直接的な検証論文とは位置づけない。書誌情報は出版社のページで確認。Uchihara論文の2026年訂正は所属情報の補足であり、分析や採点の訂正ではない。
