#!/usr/bin/env sh
set -eu

flask --app hr_production db upgrade head
