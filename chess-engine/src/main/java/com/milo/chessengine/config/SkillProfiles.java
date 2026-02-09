package com.milo.chessengine.config;

public final class SkillProfiles {

    private SkillProfiles() {}

    public static SkillProfile forEngineElo(int elo) {
        EloProfile profile = EngineConfigMapper.forElo(elo);
        int noise = profile.elo() <= 1200 ? 80 : 20;
        return new SkillProfile(
                profile.depthCap(),
                profile.maxTimeMillis(),
                noise,
                profile.blunderProb(),
                profile.blunderProb()
        );
    }
}
