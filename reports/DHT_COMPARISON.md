# DHT / Discovery Comparison

This report is generated as part of the feasibility prototype. It records the expected baseline before live manual testing in Chrome. Update the result columns after running each adapter from the extension page.

| Adapter | Browser | MV3 | Public Infra | Publish | Fetch | Viable |
| --- | --- | --- | --- | --- | --- | --- |
| Tracker-based | Yes: WebSocket + WebRTC APIs | Partial: page/offscreen likely, service worker depends on WebSocket lifetime | Yes: public WebTorrent-compatible WSS trackers | Partial: can announce to tracker, but tracker does not store payloads | No durable fetch; only live peer signaling | No as mailbox; possible as live signaling candidate |
| WebTorrent | Yes for browser WebRTC swarms | Partial: better in page/offscreen than service worker | Yes: public WSS trackers | Only with a live seeder and torrent metadata | Only with live peers/content availability | No as mailbox; possible for simultaneous peer discovery |
| libp2p | Theoretically yes with WebRTC/WebTransport/WSS transports | Failed in this prototype: page startup can freeze visible UI; offscreen startup can leave the extension unresponsive | Yes: IPFS Amino DHT bootstrap nodes via DNSADDR | Implemented but disabled in UI for safety | Implemented but disabled in UI for safety | No for current MV3 prototype |
| Helia/IPFS | Yes in browser with IndexedDB-capable storage | Partial: page/offscreen preferred | Yes: IPFS/libp2p public infra | Immutable add is possible with Helia, but not keyed mailbox publish here | Gateway fetch needs a known CID, not mailbox seed lookup | No for mailbox as specified without mutable routing |
| Experimental | Unknown | Unknown | None configured | No | No | No |

## Notes

- Chrome MV3 service workers are ephemeral, so long-lived discovery nodes should not rely on background execution.
- Public trackers are useful for live WebRTC signaling, but they are not mailbox storage and do not provide historical retrieval.
- Classic BitTorrent UDP DHT is not directly available in browser extension JavaScript because browser APIs do not expose raw UDP/TCP sockets.
- The libp2p adapter now performs the real public-DHT operation that is feasible from a browser: provider record publish/discovery for a deterministic mailbox CID. This is peer discovery, not durable message storage.
- In the visible extension page, js-libp2p startup can block the main thread before UI logs/timeouts render. In offscreen context, startup can leave the extension unresponsive. The UI disables both probes for `libp2p` and records this as a hard blocker.
