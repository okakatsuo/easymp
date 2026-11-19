# EasyMP 画像投写の通信解析

2026-11-19 に Wireshark 付属の TShark で、Wi-Fi 接続した EMP-1715 とライブラリ間の通信を測定した。現行版と改良版のキャプチャには、同じプロジェクターの EasyMP と ESC/VP.net ポートだけを含めた。

| EMP-1715 の実測 | 0.2.0 | 0.3.0 |
| --- | ---: | ---: |
| 最初の探索応答から接続要求の送信まで | 約 614 ms | 約 0.76 ms |
| 接続要求までのユニキャスト探索要求 | 7 回 | 1 回 |
| 切断要求から確認応答まで | 約 343 ms | 約 433 ms |

いずれも 1 回のキャプチャでの観測値。0.2.0 の切断処理は 100 ms 待ってソケットを閉じていた。0.3.0 では確認応答を最長 1 秒待つ。接続時の `0x05` と切断確認の `0x07` は、TCP のセグメント境界に依存せず、20 バイトの EEMP ヘッダーとリトルエンディアンのペイロード長で読み取る。

EMP-1715 では UDP 3620 で探索 `0x02 → 0x03` と接続要求 `0x04` が流れる。制御はプロジェクターからライブラリへ折り返す TCP 3620 で、接続通知 `0x05`、キープアライブ `0x0a`、切断 `0x06 → 0x07` を確認した。画像はライブラリから TCP 3621 に送る。改良版で同じ画像を 3 回指定したとき、初回と `fullFrameInterval` 経過後に、4 タイルずつの EPRD パケットが送信された。

## LibreMP の公開キャプチャとの比較

[LibreMP の解析ノート](https://github.com/MuazTPM-YT/libre-mp/blob/main/docs/NOTES.md) が参照する [Windows iProjection のキャプチャ](https://github.com/MuazTPM-YT/libre-mp/blob/b1a85c2/test.pcap) では、クライアントが TCP 3620 に接続し、登録 `0x0002` とログイン `0x0101` を送る。終了時には `0x0104 → 0x0105` が流れる。本ライブラリが対応する EMP-1715 の接続手順は UDP から始まる。

TCP 3621 の映像ストリームを再構成し、先頭のチャネル設定と表示メタデータの後に続く JPEG ブロックを取り出した。ブロックから座標、寸法、JPEG データを読み、`createEprdPacket()` に渡して比較したところ、105 ブロック、233 タイルすべてが元のバイト列と一致した。全面再送を一定間隔で行うオプションは、LibreMP の画面更新方式を参考にした。

## TShark で確認する

キャプチャ時のインターフェース名や番号は `tshark -D` で確認する。出力先ディレクトリを用意し、インターフェース番号とプロジェクターの IP アドレスを実環境に合わせて変更する。

```sh
tshark -i 3 -f "host 192.168.1.82 and (port 3620 or port 3621 or port 3629)" -a duration:20 -w .cache/easymp.pcapng
tshark -r .cache/easymp.pcapng -Y "udp.port == 3620 || (tcp.port == 3620 && tcp.len > 0)" -T fields -e frame.time_relative -e ip.src -e udp.payload -e tcp.payload
```

LibreMP のキャプチャでは、以下で映像チャネルの送受信データを方向別に再構成できる。

```sh
tshark -r test.pcap -q -z "follow,tcp,raw,2"
```
