-- Demo fitness inventory for adiasports and Fitness Empire.
-- Run after branches-two-locations.sql.

insert into public.products (
  branch_id, name, sku, unit, category, quantity, reorder_level, cost_price, unit_price
) values
  ('adiasports', 'Dumbbell 5kg Pair', 'FIT-001-A', 'pair', 'Weights', 18, 4, 42000, 55000),
  ('adiasports', 'Dumbbell 10kg Pair', 'FIT-002-A', 'pair', 'Weights', 12, 3, 78000, 98000),
  ('adiasports', 'Resistance Band Set', 'FIT-003-A', 'set', 'Accessories', 35, 8, 18000, 28000),
  ('adiasports', 'Yoga Mat 6mm', 'FIT-004-A', 'pcs', 'Accessories', 28, 6, 22000, 35000),
  ('adiasports', 'Skipping Rope Pro', 'FIT-005-A', 'pcs', 'Cardio', 45, 10, 9000, 15000),
  ('adiasports', 'Gym Gloves', 'FIT-006-A', 'pair', 'Accessories', 32, 8, 12000, 20000),
  ('adiasports', 'Weight Lifting Belt', 'FIT-007-A', 'pcs', 'Accessories', 16, 4, 30000, 48000),
  ('adiasports', 'Protein Shaker 700ml', 'FIT-008-A', 'pcs', 'Nutrition', 40, 10, 8000, 14000),
  ('adiasports', 'Whey Protein 1kg', 'FIT-009-A', 'tub', 'Nutrition', 20, 5, 78000, 105000),
  ('adiasports', 'Kettlebell 12kg', 'FIT-010-A', 'pcs', 'Weights', 10, 3, 65000, 85000),
  ('fitness-empire', 'Dumbbell 5kg Pair', 'FIT-001-F', 'pair', 'Weights', 14, 4, 42000, 55000),
  ('fitness-empire', 'Dumbbell 10kg Pair', 'FIT-002-F', 'pair', 'Weights', 9, 3, 78000, 98000),
  ('fitness-empire', 'Resistance Band Set', 'FIT-003-F', 'set', 'Accessories', 25, 8, 18000, 28000),
  ('fitness-empire', 'Yoga Mat 6mm', 'FIT-004-F', 'pcs', 'Accessories', 21, 6, 22000, 35000),
  ('fitness-empire', 'Skipping Rope Pro', 'FIT-005-F', 'pcs', 'Cardio', 30, 10, 9000, 15000),
  ('fitness-empire', 'Gym Gloves', 'FIT-006-F', 'pair', 'Accessories', 24, 8, 12000, 20000),
  ('fitness-empire', 'Weight Lifting Belt', 'FIT-007-F', 'pcs', 'Accessories', 12, 4, 30000, 48000),
  ('fitness-empire', 'Protein Shaker 700ml', 'FIT-008-F', 'pcs', 'Nutrition', 28, 10, 8000, 14000),
  ('fitness-empire', 'Whey Protein 1kg', 'FIT-009-F', 'tub', 'Nutrition', 15, 5, 78000, 105000),
  ('fitness-empire', 'Kettlebell 12kg', 'FIT-010-F', 'pcs', 'Weights', 8, 3, 65000, 85000)
on conflict do nothing;
