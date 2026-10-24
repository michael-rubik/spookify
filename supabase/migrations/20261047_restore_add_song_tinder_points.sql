-- Restores the Add song to game points that the FMK reset (20261046) also zeroed: a song earns 1 per right
-- swipe, and a submitter's score is the sum of their songs' points. Safe to run more than once.
do $$
begin
  -- The profile guard only lets score and badge changes through while this flag is on.
  perform set_config('spookify.award', 'on', true);

  update public.spookify_songs s set points = (
    select count(*) from public.spookify_swipes w where w.song_id = s.id and w.direction = 'right'
  );

  update public.users u set
    submitter_score = coalesce((select sum(s.points) from public.spookify_songs s where s.added_by = u.id), 0);
  update public.users set spookify_score = tinder_score + fmk_score + submitter_score;

  update public.users set badges = array_append(badges, 'songmaster')
  where spookify_score >= 100 and not ('songmaster' = any(badges));
end;
$$;
