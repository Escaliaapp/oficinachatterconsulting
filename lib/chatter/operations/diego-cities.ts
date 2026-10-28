export const DIEGO_CITIES = [
  'Ciudad de México','Guadalajara','Monterrey','Mérida','Los Cabos','Querétaro','Cancún','Tulum','Puebla','Durango','Mazatlán','Puerto Vallarta','Tijuana',
  'León','San Luis Potosí','Aguascalientes','Chihuahua','Hermosillo','Mexicali','Veracruz','Oaxaca','Toluca','Morelia','Cuernavaca','Saltillo','Torreón','Acapulco','Playa del Carmen','Ensenada','Villahermosa',
] as const;

export function randomDiegoCity() { return DIEGO_CITIES[Math.floor(Math.random() * DIEGO_CITIES.length)]; }
