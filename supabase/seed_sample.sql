-- Optional sample data (spec §11 "template with sample data"). Run once in the SQL editor.
insert into public.cohorts (course_name, cohort) values
  ('Foundations of Math for ML, DS and AI', '2026-Jan'),
  ('Data Science', '2026-Jan'),
  ('Analytics', '2026-Feb')
on conflict do nothing;

insert into public.sessions (cohort_id, session_number, title, session_date, topic, feedback_open)
select c.id, s.n, s.title, s.d::date, s.topic, s.open
from public.cohorts c
join (values
  ('Foundations of Math for ML, DS and AI', 1, 'Vectors and matrices', '2026-01-10', 'Vectors, dot products and matrix multiplication', true),
  ('Foundations of Math for ML, DS and AI', 2, 'Derivatives and gradients', '2026-01-17', 'Partial derivatives and the gradient', false),
  ('Data Science', 1, 'The data science workflow', '2026-01-12', 'From question to cleaned dataset', true)
) as s(course, n, title, d, topic, open) on s.course = c.course_name and c.cohort = '2026-Jan'
on conflict do nothing;
