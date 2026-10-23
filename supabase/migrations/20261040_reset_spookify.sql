-- One-off reset of Spookify: removes every pool song with its swipes and FMK data, zeroes all Spookify scores
-- and takes back the badges earned from Spookify (and Winner winner, which needs every regular badge).
-- Run once; it is destructive and cannot be undone.
do $$
begin
  -- The profile guard only lets score and badge changes through while this flag is on.
  perform set_config('spookify.award', 'on', true);

  delete from public.spookify_fmk_pairs;
  delete from public.spookify_fmk_tiers;
  delete from public.spookify_swipes;
  delete from public.spookify_songs;

  update public.users
  set spookify_score = 0,
      tinder_score = 0,
      fmk_score = 0,
      submitter_score = 0
  where (spookify_score, tinder_score, fmk_score, submitter_score) <> (0, 0, 0, 0);

  update public.users
  set badges = array(
    select b from unnest(badges) b
    where b not in ('songmaster', 'fan', 'swipes', 'fmk', 'winner-winner')
  )
  where badges && array['songmaster', 'fan', 'swipes', 'fmk', 'winner-winner'];
end;
$$;
