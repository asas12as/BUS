-- Add mapping from a place (stop) to its bus (line)
-- Each pickup place belongs to a specific bus

alter table public.places
  add column if not exists bus_id uuid
    references public.places(id) on delete set null;

-- Ensure all existing places (kind='place') have a bus_id
-- If multiple buses exist, this is a choice; but for now, 
-- if there's exactly one bus, assign it. Otherwise leave null.
do $$
declare
  v_bus_count integer;
  v_single_bus uuid;
begin
  select count(*) into v_bus_count from public.places where kind='bus' and archived=false;
  if v_bus_count = 1 then
    select id into v_single_bus from public.places where kind='bus' and archived=false limit 1;
    update public.places set bus_id = v_single_bus where kind='place' and bus_id is null;
  end if;
end;
$$;