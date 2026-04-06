# 8bit BGM Composer v001

個人利用向けの 8bit BGM 制作アプリの最小版です。

## v001 の対応範囲

- Next.js + TypeScript ベース
- 4トラック固定
  - Pulse Lead
  - Pulse Sub
  - Triangle Bass
  - Noise Drum
- 1小節16ステップ編集
- 小節選択
- パターン複製
- 再生 / 停止
- ループON/OFF
- ループ開始小節 / 終了小節
- ループ確認向け再生
- JSONプロジェクト保存 / 読込
- WAV書き出し
  - stereo
  - 44.1kHz / 48kHz
  - 16bit / 24bit PCM

## 未対応

- MP3書き出し
- 自動作曲補助
- 複数パターンの高度な管理
- 細かい音色編集

## セットアップ

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開いて使います。

## Vercel へ上げる手順

1. このフォルダをそのまま GitHub リポジトリへ入れる
2. Vercel でその GitHub リポジトリを import する
3. Framework Preset は Next.js のままでよい
4. 追加の環境変数は不要

## 保存ファイル

保存形式は `.eightbit.json` です。
中身は JSON のプロジェクトデータです。

## 版管理ルール

今後の修正版フォルダは次のように連番にします。

- 8bit-bgm-app-v001
- 8bit-bgm-app-v002
- 8bit-bgm-app-v003

差し替えがある場合は、毎回次の形で明示します。

- 対象フォルダ
- 差し替えるファイルの相対パス
- 新規追加ファイルの相対パス
- 削除するファイルの相対パス

## 主なファイル

- `app/page.tsx`
- `components/ComposerApp.tsx`
- `lib/types.ts`
- `lib/defaultProject.ts`
- `lib/music.ts`
- `lib/audio.ts`

## 注意

この版は最小版です。
ローカル保存、ブラウザ再生、WAV書き出しを先に成立させる構成に寄せています。
MP3 は次版で追加しやすいように export format の選択だけ先に入れています。
