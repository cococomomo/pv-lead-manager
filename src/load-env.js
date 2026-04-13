'use strict';

/** Eine zentrale Stelle: Projekt-`.env` immer relativ zu `src/`, unabhängig vom aktuellen Arbeitsverzeichnis. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
