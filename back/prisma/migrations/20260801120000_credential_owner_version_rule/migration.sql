-- AlterEnum: a version rule holds its own secret, so it becomes a credential owner.
ALTER TYPE "CredentialOwner" ADD VALUE 'versionRule';
