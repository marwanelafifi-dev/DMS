-- Admin-editable dropdown lists (Department, Category, Tags) shown on the
-- Company Data admin page. Seeded with the values that were previously
-- hardcoded in the upload form so switching over changes nothing for
-- existing users.
CREATE TABLE IF NOT EXISTS dms_dropdown_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_key TEXT NOT NULL,
    label TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (list_key, label)
);
CREATE INDEX IF NOT EXISTS idx_dropdown_items_list_key ON dms_dropdown_items(list_key);

INSERT INTO dms_dropdown_items (list_key, label, sort_order) VALUES
  ('category', 'Policy', 1), ('category', 'Process', 2), ('category', 'Standard', 3),
  ('category', 'Template', 4), ('category', 'Working Document', 5),
  ('department', 'Quality Assurance', 1), ('department', 'Information Security', 2),
  ('department', 'Operations', 3), ('department', 'Human Resources', 4), ('department', 'IT', 5),
  ('department', 'Finance', 6), ('department', 'Management', 7),
  ('tag', 'ISO 9001', 1), ('tag', 'ISO 27001', 2), ('tag', 'Quality', 3), ('tag', 'Procedure', 4),
  ('tag', 'Policy', 5), ('tag', 'Compliance', 6), ('tag', 'Security', 7), ('tag', 'Audit', 8),
  ('tag', 'Template', 9)
ON CONFLICT (list_key, label) DO NOTHING;
