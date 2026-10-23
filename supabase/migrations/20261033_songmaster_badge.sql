-- Reaching 100 Spookify points awards the add-only "songmaster" badge, granted server-side with the points.
create or replace function private.award_spookify(
  p_user uuid,
  p_tinder numeric,
  p_fmk numeric,
  p_submitter numeric
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('spookify.award', 'on', true);
  update public.users
    set tinder_score = tinder_score + p_tinder,
        fmk_score = fmk_score + p_fmk,
        submitter_score = submitter_score + p_submitter,
        spookify_score = spookify_score + p_tinder + p_fmk + p_submitter,
        badges = case
          when spookify_score + p_tinder + p_fmk + p_submitter >= 100 and not ('songmaster' = any(badges))
            then array_append(badges, 'songmaster')
          else badges
        end
    where id = p_user;
  perform set_config('spookify.award', 'off', true);
end;
$$;
revoke all on function private.award_spookify(uuid, numeric, numeric, numeric) from public, anon, authenticated;

update public.users
  set badges = array_append(badges, 'songmaster')
  where spookify_score >= 100 and not ('songmaster' = any(badges));
