const target = new URL("/", location.origin);
target.search = location.search;
target.hash = location.hash;
location.replace(target);
