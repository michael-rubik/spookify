-- One-off reset of Spookify FMK and the Add song to game points. Removes every FMK round (tiers, pairs,
-- dealt trios, skips), zeroes the FMK and Add song to game scores and every song's points, and takes back
-- the FMK badge and the Songmaster badge when the remaining score no longer earns it.
-- Songs and Tinder swipes (with the Tinder score) are kept. Run once; it is destructive and cannot be undone.
do $$
begin
  -- The profile guard only lets score and badge changes through while this flag is on.
  perform set_config('spookify.award', 'on', true);

  delete from public.spookify_fmk_trios;
  delete from public.spookify_fmk_skips;
  delete from public.spookify_fmk_pairs;
  delete from public.spookify_fmk_tiers;

  update public.spookify_songs set points = 0 where points <> 0;

  update public.users
  set fmk_score = 0,
      submitter_score = 0,
      spookify_score = tinder_score
  where (fmk_score, submitter_score) <> (0, 0);

  update public.users
  set badges = array(
    select b from unnest(badges) b
    where b <> 'fmk' and not (b = 'songmaster' and spookify_score < 100)
  )
  where 'fmk' = any(badges) or ('songmaster' = any(badges) and spookify_score < 100);
end;
$$;
