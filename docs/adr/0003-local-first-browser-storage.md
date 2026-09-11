# Keep the application local-first with layered browser state

Ship curated catalog facts as versioned read-only application data while storing generated Scenarios and reversible property overrides in IndexedDB with versioned migrations and JSON import/export. This avoids a hosted backend for a personal offline tool without allowing browser-local edits to overwrite the authority or provenance of bundled source data.
