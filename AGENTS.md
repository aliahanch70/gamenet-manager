# Architecture rules

- Bound authentication and device-read waits with the shared offline recovery helper, so unavailable networking cannot leave initial loading pending forever.
- Offline cloud display may restore the SDK session and that user's game-center cache, but must never grant roles from browser storage; cloud permissions remain server-validated.