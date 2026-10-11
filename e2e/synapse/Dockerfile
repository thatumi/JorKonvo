# Disposable test Synapse with the e2e config baked in.
#
# Baking the config into the image (instead of a bind mount) is what lets
# `./e2e/scripts/up.sh` work unchanged from a docker-outside-of-docker CI
# job: the build context is streamed to the daemon as a tar, whereas a
# bind-mount source path would be resolved on the host and not exist.
#
# The signing key is generated at build time and lives only inside this
# throwaway image - never committed, regenerated on every rebuild.
FROM matrixdotorg/synapse:latest

COPY homeserver.yaml /data/homeserver.yaml
COPY log.config /data/log.config

RUN python -m synapse.app.homeserver -c /data/homeserver.yaml --generate-keys \
    && chown -R 991:991 /data

CMD ["run"]
