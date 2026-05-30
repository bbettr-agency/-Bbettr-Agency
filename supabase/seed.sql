-- ============================================================================
-- Seed data for local development & demos.
--
-- NOTE: auth users must be created via Supabase Auth (Dashboard or the admin
-- API in the app). After creating an auth user, note their UUID and link it
-- below by updating the profile the trigger created, or insert manually.
--
-- This seed creates a demo tenant + content so the portal has something to
-- show. Replace the placeholder UUIDs with real auth.users IDs as needed.
-- ============================================================================

-- Demo tenant ---------------------------------------------------------------
insert into clients (id, name, contact_name, contact_email, contact_phone, company, status)
values (
  '11111111-1111-1111-1111-111111111111',
  'Botha Family Practice',
  'Dr PM Botha',
  'dr.botha@example.com',
  '+27 82 000 0000',
  'Botha Family Practice',
  'in_progress'
)
on conflict (id) do nothing;

-- Services purchased --------------------------------------------------------
insert into client_services (client_id, service, onboarding_status) values
  ('11111111-1111-1111-1111-111111111111', 'website', 'submitted'),
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'in_progress')
on conflict do nothing;

-- Progress tracker ----------------------------------------------------------
insert into project_stages (client_id, name, description, status, position) values
  ('11111111-1111-1111-1111-111111111111', 'Contract Signed', 'Agreement finalised', 'completed', 1),
  ('11111111-1111-1111-1111-111111111111', 'Onboarding Submitted', 'Brief received', 'completed', 2),
  ('11111111-1111-1111-1111-111111111111', 'Assets Received', 'Logo & images in', 'completed', 3),
  ('11111111-1111-1111-1111-111111111111', 'Website In Development', 'Building your site', 'in_progress', 4),
  ('11111111-1111-1111-1111-111111111111', 'Review Stage', 'Your feedback round', 'pending', 5),
  ('11111111-1111-1111-1111-111111111111', 'Launch', 'Go live', 'pending', 6)
on conflict do nothing;

-- Updates feed --------------------------------------------------------------
insert into updates (client_id, title, body, published_at, author_name) values
  (
    '11111111-1111-1111-1111-111111111111',
    'Google Ads Optimisation Completed',
    'We completed keyword optimisation and added new conversion tracking. Early results show a 22% drop in cost per lead.',
    '2026-05-15',
    'Bbettr Agency'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Homepage Design Approved',
    'Your homepage concept is signed off. We are now building out the inner pages and wiring up the contact forms.',
    '2026-05-08',
    'Bbettr Agency'
  )
on conflict do nothing;

-- Reports -------------------------------------------------------------------
insert into reports (
  client_id, reporting_month, ad_spend, leads_generated, cost_per_lead,
  clicks, impressions, conversion_rate, summary, key_wins, opportunities, next_month_plan
) values (
  '11111111-1111-1111-1111-111111111111',
  '2026-04-01',
  14500.00, 86, 168.60, 2940, 142500, 4.20,
  'Strong month with steady lead growth and improved efficiency across the account.',
  'Cost per lead down 18% month-on-month. Top campaign hit a 5.1% conversion rate.',
  'Landing page speed can be improved to lift conversion further. Remarketing audience is ready to scale.',
  'Launch remarketing campaigns and expand into two new service keywords.'
)
on conflict do nothing;
