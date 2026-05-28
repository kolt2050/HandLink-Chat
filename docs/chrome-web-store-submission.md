# Chrome Web Store Submission Notes

Copy-ready text for the Chrome Web Store Developer Dashboard.

## Extension Package

Upload:

```text
group-handlink-chat-0.1.0.zip
```

This ZIP should contain the contents of the production `dist/` folder, not the `dist` folder itself.

## Privacy Policy URL

After publishing the `docs/` folder with GitHub Pages or another static host, use:

```text
https://kolt2050.github.io/browser-chat/privacy-policy.html
```

Replace the URL if the final hosting path is different.

## Short Description

```text
Manual encrypted P2P group chat with local history, images, mentions, and no project-owned backend.
```

## Detailed Description

```text
Group HandLink Chat is a browser extension for manual encrypted peer-to-peer group chat.

Users create a chat invite, exchange offer and answer text manually, and then chat directly through WebRTC DataChannel. The extension supports multi-user chat, local message history, user mentions, sound alerts for new mentions, image messages from file or clipboard, clickable links, light and dark themes, and multiple interface languages.

Messages are encrypted with the shared room secret from the invite. Chat history is stored locally in the browser. Image attachments are compressed locally and stored inside messages as base64/data URLs. Large encrypted payloads are sent in chunks so message history and image messages can sync reliably.

The extension does not use a project-owned backend server, account system, analytics, advertising, payment processing, AI service, or remote code. Signaling is manual: users exchange invite, offer, and answer text themselves. WebRTC uses Google's public STUN server only for NAT traversal.
```

## Single Purpose Statement

```text
The extension has one purpose: provide manual encrypted peer-to-peer group chat with local browser history for users who explicitly exchange invite and answer text.
```

## Permission Justifications

### `storage`

```text
Required to store local extension preferences, nickname, peer identifier, invite state, read mention state, and local chat history in the user's browser.
```

### `tabs`

```text
Required to open the extension chat interface in a browser tab when the user clicks the extension action.
```

### `offscreen`

```text
Required to keep the WebRTC chat runtime active while the extension UI is refreshed or closed, maintain local runtime state, and play local sound alerts for mentions.
```

## Data Usage Disclosure

The extension stores the following data locally in the user's browser:

- nickname;
- local peer identifier;
- locale and theme preferences;
- chat invites and room identifiers;
- manual connection state;
- encrypted chat-derived local room state;
- message history, including text, image data URLs, timestamps, authors, and mention metadata;
- read mention state.

Suggested disclosure:

```text
The extension stores chat data locally in the user's browser. This data is used only to preserve chat state, display local history, sync messages with manually invited peers, and show mention notifications. The extension does not sell, transfer, or use this data for advertising, analytics, or unrelated purposes.
```

## Third-Party Requests Disclosure

```text
The extension does not make project-owned backend requests and does not send chat data to analytics or advertising services. WebRTC uses Google's public STUN server at stun:stun.l.google.com:19302 only for NAT traversal.
```

## Remote Code Disclosure

```text
No remote code is loaded or executed. All JavaScript, UI code, WebRTC logic, encryption helpers, and storage logic are bundled with the extension package.
```

## Privacy Practices Summary

```text
Group HandLink Chat does not collect data for tracking or advertising. Chat data remains local in the user's browser unless the user sends encrypted messages to manually invited peers.
```

## Screenshots

Use the prepared screenshots:

```text
docs/screenshots/screenshot-1-chat.jpg
docs/screenshots/screenshot-2-how-it-works.jpg
```

Both are `1280 x 800` JPEG files.
