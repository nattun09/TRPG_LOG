#!/usr/bin/env python3
"""Discordサーバーの「イベント」を取得して data/events.json に保存する。

必要な環境変数:
  DISCORD_BOT_TOKEN   ボットのトークン（GitHubのSecretsに登録）
  DISCORD_GUILD_ID    サーバーID
任意:
  INCLUDE_DESCRIPTION 1: 説明文も公開する(既定) / 0: 公開しない
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("DISCORD_API_BASE", "https://discord.com/api/v10")
TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
GUILD = os.environ.get("DISCORD_GUILD_ID", "").strip()
INCLUDE_DESC = os.environ.get("INCLUDE_DESCRIPTION", "1") != "0"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "events.json")


def get(path):
    req = urllib.request.Request(
        API + path,
        headers={
            "Authorization": "Bot " + TOKEN,
            "User-Agent": "DiscordBot (https://github.com/, 1.0)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def main():
    if not TOKEN or not GUILD:
        sys.exit("DISCORD_BOT_TOKEN と DISCORD_GUILD_ID を設定してください")

    try:
        raw = get("/guilds/%s/scheduled-events" % GUILD)
    except urllib.error.HTTPError as e:
        # トークンを出力に含めないよう、ステータスだけ表示する
        sys.exit("Discord API エラー: HTTP %s %s" % (e.code, e.reason))

    # チャンネル名の取得（失敗しても続行）
    channels = {}
    try:
        for c in get("/guilds/%s/channels" % GUILD):
            channels[c["id"]] = c.get("name", "")
    except Exception:
        pass

    events = []
    for ev in raw:
        etype = ev.get("entity_type")  # 1:ステージ 2:ボイス 3:外部
        if etype == 3:
            place = (ev.get("entity_metadata") or {}).get("location", "")
        else:
            name = channels.get(ev.get("channel_id") or "", "")
            place = ("🔊 " + name) if name else "Discord"
        events.append({
            "id": ev["id"],
            "name": ev.get("name", ""),
            "description": (ev.get("description") or "") if INCLUDE_DESC else "",
            "start": ev.get("scheduled_start_time"),
            "end": ev.get("scheduled_end_time"),
            "location": place,
            "url": "https://discord.com/events/%s/%s" % (GUILD, ev["id"]),
        })
    events.sort(key=lambda e: e["start"] or "")

    new_text = json.dumps({"events": events}, ensure_ascii=False, indent=2) + "\n"
    try:
        with open(OUT, encoding="utf-8") as f:
            if f.read() == new_text:
                print("変更なし")
                return
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(new_text)
    print("%d 件のイベントを保存しました" % len(events))


if __name__ == "__main__":
    main()
