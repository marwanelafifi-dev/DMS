import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import actual_pilot_migration as migration


class ActualPilotMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = migration.load_plan()
        cls.legacy = migration.load_legacy_data()
        cls.dump_text = migration.load_dump_text(migration.SOURCE_DUMP)
        cls.folders_by_id, _ = migration.load_legacy_folders()

    def test_exact_pilot_ids_are_fixed(self):
        self.assertEqual(
            tuple(row["legacy_document_id"] for row in self.plan),
            migration.PILOT_IDS,
        )

    def test_owner_emails_come_unambiguously_from_legacy_accounts(self):
        identities = migration.resolve_owner_identities(self.plan, self.dump_text)
        self.assertEqual(identities["Mostafa Medhat"].email, "mostafa.medhat@si-ware.com")
        self.assertEqual(identities["Mina Gad"].email, "mina.gad@si-ware.com")
        self.assertEqual(identities["Mohamed El Arabawy"].email, "mohamed.elarabawy@si-ware.com")
        self.assertEqual(identities["Yasseen Nada"].email, "yasseen.nada@si-ware.com")

    def test_plan_still_matches_senior_approved_owner_workbooks(self):
        migration.validate_approved_owner_plan(self.plan)

    def test_active_version_is_current_metadata_pointer(self):
        for row in self.plan:
            doc = self.legacy["document_by_id"][row["legacy_document_id"]]
            metadata = self.legacy["metadata_by_id"][doc["metadata_version_id"]]
            self.assertEqual(metadata["content_version_id"], row["active_content_version_id"])

    def test_target_folder_comes_from_folder_fk_not_document_full_path(self):
        for row in self.plan:
            doc = self.legacy["document_by_id"][row["legacy_document_id"]]
            chain = migration.folder_chain(doc["folder_id"], self.folders_by_id)
            target_path = chain[-1]["full_path"]
            self.assertNotEqual(target_path, doc["full_path"])
            self.assertTrue(doc["full_path"].startswith(target_path + "/"))

    def test_ids_are_deterministic_and_namespaced(self):
        first = migration.stable_uuid("document", "230")
        self.assertEqual(first, migration.stable_uuid("document", "230"))
        self.assertNotEqual(first, migration.stable_uuid("active-version", "230"))


if __name__ == "__main__":
    unittest.main()
