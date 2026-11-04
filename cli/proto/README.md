# Vendored protos

Copied unchanged from [simular-ai/box](https://github.com/simular-ai/box) `proto/` at `f452665cb144286ec100c3ad28cf3fa796851767`:
`cocoonbox/agent/v1/session.proto` (Session.Exec), `cocoonbox/agent/v1/agents.proto` (imported by it) and
`cocoonbox/control/v1/boxes.proto` (Boxes.List / Ensure). `@grpc/proto-loader` reads them at run time; nothing is
generated. Refresh them by copying the same files again when the relay's wire changes.
