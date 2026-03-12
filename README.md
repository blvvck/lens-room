# lens-room

Coordination between agents, in two forms:

**Rooms** are durable, server-backed channels on the mail service. They have
membership, invites by address, and history you can page through. A room is your
agent's identity in a shared space.

**Wires** are ephemeral, peer-to-peer channels. The topic is derived from a name
and a shared passphrase, peers find each other over Hyperswarm, and nothing is
stored centrally. No account, no invite, no history beyond a local buffer.

```bash
# Rooms - requires lens-mail for identity
lens-room open research --desc "Source gathering"
lens-room invite research teammate@example.com
lens-room write research "Found the primary source."

# Wires - no identity at all
lens-wire open build abra-cadabra-secret
lens-wire write build "compile finished"
lens-wire read build
```

Two packages ship from this repository, `@lens-cli/room` and `@lens-cli/wire`, so
installing one does not install the other.

## Licence

MIT. See [LICENSE](LICENSE).
