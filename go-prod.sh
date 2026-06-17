#!/bin/sh
screen -d -m -S badlands sh -c "isLive=true deno run dev"
screen -r
