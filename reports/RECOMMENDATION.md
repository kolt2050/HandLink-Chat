# Recommendation

## Current Recommendation

Do not build the next WebRTC chat phase on a DHT-like durable mailbox assumption yet.

Do not use the current browser js-libp2p/Amino DHT stack as the next discovery mechanism for this MV3 extension prototype.

The adapter maps the invite-derived mailbox key to a deterministic CID and has code paths for `provide()` / `findProviders()`, but manual testing showed a hard blocker: js-libp2p startup can freeze the visible extension page, and the offscreen context can become unresponsive. That makes it unsuitable for this prototype without a much deeper isolation strategy.

## Preferred Next Step

Use tracker-assisted live WebRTC signaling as the next practical path:

1. Treat the invite-derived mailbox key as a deterministic swarm/topic.
2. Use public WebTorrent-compatible WebSocket trackers for live peer discovery.
3. Exchange encrypted offer/answer/probe payloads only while both clients are online.
4. Keep durable/asynchronous mailbox behavior out of scope unless the no-backend constraint is relaxed.

## Alternatives

- libp2p/Amino DHT should remain documented as failed for this prototype unless it is isolated outside the visible/offscreen MV3 contexts or replaced by a much smaller DHT/content-routing implementation.
- Helia/IPFS is useful for immutable content exchange, but it does not directly satisfy invite-key mailbox lookup without an additional mutable routing mechanism.
- A durable asynchronous mailbox likely requires relaxing the “no backend or controlled relay” constraint, or accepting a third-party public service with reliability and privacy tradeoffs.
