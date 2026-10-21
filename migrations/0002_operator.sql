create table operator_state (
  id integer primary key,
  cursor_height bigint,
  lock_until_ms bigint not null default 0
);

insert into operator_state (id, cursor_height, lock_until_ms) values (1, null, 0);

create table operator_positions (
  pool text primary key,
  token text not null,
  symbol text not null,
  name text not null,
  creator text not null,
  status text not null,
  tokens text not null default '0',
  supra_spent text not null default '0',
  price text not null default '0',
  peak_price text not null default '0',
  opened_ms bigint not null,
  hit_double boolean not null default false,
  runner_trimmed boolean not null default false,
  dev_sold boolean not null default false,
  graduated boolean not null default false
);

create table operator_log (
  id bigserial primary key,
  at_ms bigint not null,
  tone text not null,
  symbol text not null,
  text text not null,
  tx_hash text
);
