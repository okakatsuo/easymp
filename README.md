# easymp

![CI](https://github.com/okakatsuo/easymp/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/easymp)
![License](https://img.shields.io/npm/l/easymp)

古い Epson EasyMP プロジェクターを Bun / Node.js から操作する非公式TypeScriptライブラリです。電源・状態制御には ESC/VP.net、画像表示には EasyMP の EEMP/EPRD プロトコルを使います。

> [!IMPORTANT]
> このプロジェクトはEpsonによる公式製品ではなく、Epsonとの提携・承認関係もありません。Epson、EasyMPおよび関連する名称は各権利者に帰属します。

現時点の映像プロトコルは **EMP-1715 で実機確認した通信を基準**にしています。ESC/VP.net 制御は同プロトコル対応機で利用できますが、映像表示は他機種では検証が必要です。

## セットアップ

ライブラリとして利用する場合：

```bash
bun add easymp
# または
npm install easymp
```

開発する場合：

```bash
git clone https://github.com/okakatsuo/easymp.git
cd easymp
bun install
bun run verify
```

## 高レベル API

```ts
import { EpsonProjector } from "easymp";

const projector = new EpsonProjector({
  host: "192.168.1.82",
  // 通常は自動判定。必要なら localAddress: "192.168.1.17"
});

await projector.power.on();
console.log(await projector.status.power());
console.log(await projector.status.lampHours());

await projector.display.connect();

try {
  await projector.display.rectangle({
    x: 104,
    y: 104,
    width: 128,
    height: 128,
    color: "#ff0000",
  });

  // 1024x768 に収め、128x128 JPEG タイルとして全面送信
  await projector.display.show("./dashboard.png");

  // 前回と同じタイルを省略して差分だけ送信
  await projector.display.update("./dashboard-next.png");
} finally {
  await projector.close();
}
```

`localAddress` はプロジェクターと同じサブネットの IPv4 を自動判定します。EasyMP は UDP 3620 で接続要求を送り、そのアドレスの TCP 3620 へ折り返し接続を受けます。複数 NIC や特殊なルーティングで誤判定される場合は、Tailscale などの仮想 NIC ではなくプロジェクターと同じネットワーク上のアドレスを明示してください。

## 電源だけ操作する

```ts
import { EscVpClient } from "easymp";

const control = new EscVpClient({ host: "192.168.1.82" });

await control.command("PWR ON");
console.log(await control.query("PWR")); // "01"
await control.command("PWR OFF");
```

## サンプル

```bash
# EMP-1715 に赤い 128x128 の矩形を表示
bun run dev

# 電源状態を表示。引数に on / off も指定可能
bun run example:power -- on

# 任意画像を全面表示
bun run example:image -- ./dashboard.png
```

接続先はサンプル内の既定値を変更するか、`EASYMP_HOST` と `EASYMP_LOCAL_ADDRESS` を設定します。

## 公開レイヤー

- `EpsonProjector`: 電源、状態、表示をまとめた高レベル API
- `EscVpClient`: TCP 3629 の ESC/VP.net コマンド
- `EasyMPSession`: UDP/TCP 3620 の EEMP セッション
- `EasyMPVideo`: TCP 3621 の映像チャネル
- `createEprdPacket`: JPEG タイルから EPRD パケットを生成
- `encodeFrame`: 画像のリサイズ、タイル分割、差分検出、JPEG 化

## 制約

- 映像接続要求には EMP-1715 のキャプチャから得た未解析フィールドが残っています。
- 同一マシン上では TCP/UDP 3620 を使用する EasyMP セッションを同時に複数開始できません。
- プロジェクター実機を使う統合テストは自動テストに含まれません。パケット生成・画像処理は `bun test` で検証できます。

## 対応環境

- Bun 1.3以降
- Node.js 20.9以降（ES Modules）
- EMP-1715：ESC/VP.net制御とEasyMP画像表示を実機確認済み
- その他のESC/VP.net対応機：制御APIは利用できる可能性がありますが未検証

## 開発とリリース

変更を送る前に次を実行してください。

```bash
bun run verify
bun pm pack --dry-run
```

リリースは[Semantic Versioning](https://semver.org/)に従います。GitHub Releaseを公開すると、npm Trusted Publishingを設定済みのリポジトリでは対応するバージョンがnpmへ公開されます。変更履歴は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
