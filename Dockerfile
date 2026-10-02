FROM node:22-bookworm-slim

# ffmpeg：計畫短片；Noto CJK：抽出繁體中文字型後移除，縮小映像檔
COPY scripts/extract-tc-fonts.py /tmp/extract-tc-fonts.py
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-noto-cjk fonts-noto-cjk-extra python3-fonttools \
 && python3 /tmp/extract-tc-fonts.py /app/fonts \
 && apt-get purge -y fonts-noto-cjk fonts-noto-cjk-extra python3-fonttools \
 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/extract-tc-fonts.py

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY assets ./assets
COPY data ./data
COPY scripts ./scripts

ENV NODE_ENV=production TZ=Asia/Taipei KM_DATA_DIR=/app/state PORT=8787
VOLUME ["/app/state"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
