---
name: curate-nsite
 description: Turn saved nsite directories and archives into verified searchable collections, hiding spam without deleting raw source, preserving clone stacks and signed version history.
---

# Curate an nsite collection

Inputs: original catalog/workspace, signed manifests or archive records. Outputs: validated workspace edits, publisher groups, stacked clones, filtered public catalog, reversible backup.

Use `Directory.validateCatalog` and `validateWorkspace`, then `bulkGroup`, `stackSites`, `select`, `directoryRows`, `publicCatalog`, `exportCatalog`. For archive snapshots use `Archive.buildArchiveCatalog` and `searchArchive`. Keep hidden/unwanted entries in raw storage, and preserve version provenance. Collections are separate from clone stacks. Never auto-remove publishers or merge clones based on visual similarity alone.

Validate a real consumer query, export and re-import, one hidden publisher, and version lineage before calling a directory portable.
