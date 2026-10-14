-- Phase 7: fallback sync bookkeeping (see schema.prisma: SyncRecord, SyncNode,
-- SyncConflict.incomingHash). The app role gets access through the default
-- privileges set in the app_role migration.

-- AlterTable
ALTER TABLE "SyncConflict" ADD COLUMN     "incomingHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "SyncRecord" (
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("entity","entityId","sourceNodeId")
);

-- CreateTable
CREATE TABLE "SyncNode" (
    "nodeId" TEXT NOT NULL,
    "auditMarks" JSONB NOT NULL DEFAULT '{}',
    "lastImportAt" TIMESTAMP(3),
    "imports" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyncNode_pkey" PRIMARY KEY ("nodeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncConflict_entity_entityId_sourceNodeId_incomingHash_key" ON "SyncConflict"("entity", "entityId", "sourceNodeId", "incomingHash");

