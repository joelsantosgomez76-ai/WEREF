-- Junta de una vez las "revisadas" personales antiguas del maestro y de los desarrolladores
-- en la lista compartida (question_reviews). Solo suma: no borra nada ni pisa lo ya compartido.
-- Es seguro repetirlo.

insert into public.question_reviews (qid, reviewed_at, updated_at)
select
  e.key as qid,
  max(case
        when jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric > 100000000000
          then (e.value #>> '{}')::numeric::bigint
        else (extract(epoch from clock_timestamp()) * 1000)::bigint
      end) as reviewed_at,
  (extract(epoch from clock_timestamp()) * 1000)::bigint as updated_at
from public.user_data ud
join auth.users u on u.id = ud.user_id
cross join lateral jsonb_each(ud.value) e
where ud.key = 'reviewed'
  and jsonb_typeof(ud.value) = 'object'
  and e.value not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb)
  and (u.email = 'info@we-ref.com'
       or exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'developer'))
group by e.key
on conflict (qid) do nothing;

select count(*) filter (where reviewed_at is not null) as revisadas_compartidas from public.question_reviews;
