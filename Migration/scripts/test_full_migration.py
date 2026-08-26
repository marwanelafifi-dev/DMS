import sys
import unittest
from collections import Counter
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import full_migration as migration


class FullMigrationPlanningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan, cls.legacy, cls.metadata_fields = migration.build_full_plan()
        cls.identities, cls.unresolved_identities = migration.resolve_available_owner_identities(cls.plan)
        migration.apply_owner_identity_classification(
            cls.plan, cls.identities, cls.unresolved_identities
        )

    def test_all_1008_legacy_documents_are_classified_once(self):
        self.assertEqual(len(self.plan), 1008)
        self.assertEqual(len({row["legacy_document_id"] for row in self.plan}), 1008)
        self.assertEqual(
            Counter(row["migration_status"] for row in self.plan),
            Counter({
                "pilot_already_migrated": 5,
                "ready": 884,
                "source_exception": 10,
                "owner_business_input": 109,
            }),
        )

    def test_pilots_are_idempotent_skips_and_known_source_exceptions_are_exact(self):
        by_id = {row["legacy_document_id"]: row for row in self.plan}
        self.assertEqual(
            {doc_id for doc_id, row in by_id.items() if row["migration_status"] == "pilot_already_migrated"},
            migration.PILOT_IDS,
        )
        self.assertEqual(
            {doc_id for doc_id, row in by_id.items() if row["migration_status"] == "source_exception"},
            {"164", "422", "507", "928", "1175", "1176", "1177", "1178", "1190", "1294"},
        )
        self.assertTrue(all(len(mapping) == 4 for mapping in migration.existing_mappings().values()))

    def test_active_file_is_always_the_current_metadata_pointer(self):
        for row in self.plan:
            document = self.legacy["document_by_id"][row["legacy_document_id"]]
            current_metadata = self.legacy["metadata_by_id"][document["metadata_version_id"]]
            self.assertEqual(row["active_content_version_id"], current_metadata["content_version_id"])

    def test_active_description_uses_only_the_description_metadata_field(self):
        for row in self.plan:
            document = self.legacy["document_by_id"][row["legacy_document_id"]]
            current_metadata = self.legacy["metadata_by_id"][document["metadata_version_id"]]
            fields = self.metadata_fields[(row["legacy_document_id"], current_metadata["id"])]
            self.assertEqual(row["description"], fields.get("Description", ""))

    def test_split_owner_values_and_missing_authoritative_emails_are_quarantined_not_guessed(self):
        split_rows = [row for row in self.plan if row["owner_resolution_status"] == "DOCUMENT_LEVEL_REVIEW_REQUIRED"]
        self.assertEqual(len(split_rows), 40)
        self.assertEqual(
            set(self.unresolved_identities),
            {"Belal Magdy", "Hossam Karim", "Marwan Elafifi", "Mohamed Gaber", "Sebastien Nazeer"},
        )
        self.assertTrue(all(not row.get("owner_email") for row in self.plan if row.get("new_owner_name") in self.unresolved_identities))


if __name__ == "__main__":
    unittest.main()
