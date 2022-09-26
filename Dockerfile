FROM  google/cloud-sdk:alpine AS build

ARG PORT 80
ARG PROJECT_ID
ARG GOOGLE_SERVICE_ACCOUNT
ENV GOOGLE_APPLICATION_CREDENTIALS /service/serviceAccount.json

RUN mkdir -p /service 
WORKDIR /service

RUN apk update && apk --no-cache -U upgrade && apk add --no-cache npm && npm --global i yarn patch-package && echo $GOOGLE_SERVICE_ACCOUNT > /service/serviceAccount_b64 && base64 -d /service/serviceAccount_b64 > $GOOGLE_APPLICATION_CREDENTIALS && gcloud auth activate-service-account --key-file $GOOGLE_APPLICATION_CREDENTIALS && export PATH="$(yarn global bin):$PATH" && yarn global add google-artifactregistry-auth

COPY package.json .eslintignore .prettierrc api-extractor.json rollup.config.ts tsconfig.json ./

RUN echo "@ikomida:registry=https://us-central1-npm.pkg.dev/$PROJECT_ID/node/" >> .npmrc && echo "//us-central1-npm.pkg.dev/$PROJECT_ID/node/:always-auth=true" >> .npmrc
RUN yarn glogin && yarn add @ikomida/shared-backend@latest

COPY ./src /service/src
RUN yarn build && yarn install --production

FROM node:16-alpine AS final

ENV NODE_ENV production
ENV NODEPORT ${PORT}

RUN apk update && apk --no-cache -U upgrade && addgroup -g 3000  ikomida && deluser --remove-home node && adduser -u 1000 -G ikomida -s /bin/sh -D -h /service ikomida && chown 1000:3000 /service
USER ikomida
WORKDIR /service

COPY --chown=ikomida:ikomida --from=build /service/package.json ./
COPY --chown=ikomida:ikomida --from=build /service/node_modules ./node_modules/
COPY --chown=ikomida:ikomida --from=build /service/build ./build/

EXPOSE ${PORT}

ENTRYPOINT ["node", "build/service.js"]