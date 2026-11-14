// Generated from backend/openapi.yaml by tools/contract-types/generate.mjs. Do not edit.
export interface paths {
    "/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness check */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Vocabulary, labels and scoring conventions
         * @description Single source for display labels and definitions. Clients read labels from here and do not
         *     retype them: evidence kinds, access tiers, null reasons (including "No coverage"), the
         *     needs-local-judgment flag, scores, hazards, risk levels, scenarios, job stages and the disclaimer.
         */
        get: operations["getMeta"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/coverage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Which datasets cover this field
         * @description Fast check that fetches no heavy data. Use it before starting an analysis.
         */
        post: operations["checkCoverage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/crop-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * The rotation the crop map shows on this field
         * @description Reads the crop history for the field and proposes the current rotation, for the farmer to
         *     confirm or correct before an analysis is started. The first call for a new field can take
         *     up to a minute. Where no crop-history layer exists, `detected` is null with the reason.
         */
        post: operations["getCropHistory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/crops": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Crops the backend accepts at a location
         * @description The list the rotation entry form picks from. Includes `fallow` and one generic unspecified
         *     cover crop. `suitable` is a climate screen only and is `null` where it cannot be judged.
         */
        get: operations["listCrops"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/layers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Pre-rendered context layers for the map
         * @description Raster tile layers for context only, sharpest picture first. Each is either a `picture` of
         *     the ground or a `data` map of a measurement. They are pre-coloured and must not be used to
         *     convey field risk. Field risk comes from `GET /v1/analyses/{analysis_id}/zones`, which
         *     returns class indices that the client styles.
         */
        get: operations["listLayers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/outlook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Weather forecast for the next ten days
         * @description A forecast, not a measurement and not an input to any analysis. Days are local days at the
         *     location. When the forecast service is not set up or does not answer, `available` is false,
         *     `days` is empty and `null_reason` says why.
         */
        get: operations["getOutlook"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/briefing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Today on the field
         * @description Recent rain, soil wetness, the forecast, what next month usually brings and the long record,
         *     for one point. Each part says whether it is available and, if not, why. None of it is an
         *     input to an analysis. The first call for a place can take up to a minute.
         */
        get: operations["getBriefing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/analyses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start an analysis
         * @description Returns immediately with a job. Poll `GET /v1/analyses/{analysis_id}` until `status` is
         *     `done` or `error`. The same request body always produces the same result.
         *
         *     Outside the conterminous United States there is no crop-history layer, so
         *     `farmer.current_rotation` is required there and its absence is a 422.
         */
        post: operations["createAnalysis"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/analyses/{analysis_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Job status and, when done, the result */
        get: operations["getAnalysis"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/analyses/{analysis_id}/zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Risk zones for the field as vector polygons
         * @description One layer per hazard. Polygons follow the 30 m analysis grid and carry a class index (0 lower,
         *     1 raised, 2 high) and the raw value where one exists. The client chooses colour and pattern.
         */
        get: operations["getZones"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/analyses/{analysis_id}/reasoning": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * How the result was reached, step by step
         * @description The engine's own steps for a finished analysis, rebuilt from its result. Every number is a
         *     value from the result, and each fact names the field it was read from. A language model never
         *     computes anything here. Where one is set up, it is given the ranking facts and asked to word
         *     them as the summary. Its reply is shown only when every number in it matches a fact and it
         *     gives no advice; otherwise the engine's own summary is shown and `summary` says why. The reply
         *     is kept, so the same analysis always shows the same summary.
         */
        get: operations["getReasoning"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * @description What a value is. Drawn differently by the client.
         * @enum {string}
         */
        EvidenceKind: "satellite_observation" | "ground_observation" | "soil_survey_baseline" | "model_output";
        /**
         * @description How the value was obtained. `live` was fetched from the source for this request. `snapshot`
         *     comes from a dated, pre-ingested regional copy. `modeled` was computed by this system.
         * @enum {string}
         */
        AccessTier: "live" | "snapshot" | "modeled";
        /**
         * @description Why a value is missing. `out_of_coverage` is displayed as "No coverage". Only `fetch_failed`
         *     is worth retrying.
         * @enum {string}
         */
        NullReason: "out_of_coverage" | "not_configured" | "fetch_failed" | "insufficient_observations";
        /** @enum {string} */
        CoverageScope: "global" | "us_only" | "western_us";
        /** @enum {string} */
        DatasetStatus: "available" | "unavailable" | "failed";
        /** @enum {string} */
        ScoreId: "water_balance" | "soil_health" | "erosion" | "climate_risk" | "pest_break" | "economics";
        /**
         * @description Farmer priority. Each maps to one score, in the same order as `ScoreId`.
         * @enum {string}
         */
        Priority: "conserve_water" | "build_soil" | "reduce_erosion" | "lower_weather_risk" | "break_pest_cycles" | "income";
        /** @enum {string} */
        WaterAvailability: "rain_fed" | "limited" | "reliable";
        /** @enum {string} */
        Equipment: "row_crop_planter" | "grain_drill" | "combine" | "forage_harvester" | "hay_equipment" | "specialty_harvester";
        /** @enum {string} */
        RainfallScenario: "normal" | "dry" | "very_dry";
        /** @enum {string} */
        TemperatureScenario: "normal" | "warm" | "hot";
        /** @enum {string} */
        ZoneHazard: "erosion" | "water_stress" | "heat" | "frost";
        /** @enum {string} */
        CalendarHazard: "frost" | "heat" | "dry_spell" | "extreme_rain" | "bare_field";
        /**
         * @description 0 lower, 1 raised, 2 high. Thresholds are in `Meta.risk_levels`.
         * @enum {integer}
         */
        RiskLevel: 0 | 1 | 2;
        /**
         * @description `residue` is ground covered by stubble or mulch with nothing growing. It is not bare soil.
         * @enum {string}
         */
        CoverState: "crop" | "cover_crop" | "residue" | "bare";
        /** @enum {string} */
        CropCategory: "cash" | "forage" | "cover" | "fallow";
        /** @enum {string} */
        JobStatus: "queued" | "running" | "done" | "error";
        /**
         * @description `repeating_cycle`: the recent years repeat this sequence cleanly. `recent_years`: nothing
         *     repeats cleanly, so the best-matching recent sequence is used and the farmer should check it.
         * @enum {string}
         */
        DetectionBasis: "repeating_cycle" | "recent_years";
        /** @enum {string} */
        CropFitStatus: "fits" | "strained" | "does_not_fit" | "unknown";
        /** @enum {string} */
        CropFitCheckId: "season_length" | "heat" | "frost" | "water";
        /**
         * @description `picture` shows the ground as a camera would. `data` colours a measurement, such as soil
         *     moisture, and needs its legend.
         * @enum {string}
         */
        LayerKind: "picture" | "data";
        /** @description Longitude, latitude. */
        Position: number[];
        LinearRing: components["schemas"]["Position"][];
        Polygon: {
            /** @constant */
            type: "Polygon";
            coordinates: components["schemas"]["LinearRing"][];
        };
        MultiPolygon: {
            /** @constant */
            type: "MultiPolygon";
            coordinates: components["schemas"]["LinearRing"][][];
        };
        /** @description Field boundary. Area must be between 0.5 and 2,000 hectares. */
        FieldGeometry: components["schemas"]["Polygon"] | components["schemas"]["MultiPolygon"];
        LatLon: {
            lat: number;
            lon: number;
        };
        Period: {
            /** Format: date */
            start: string;
            /** Format: date */
            end: string;
        };
        /**
         * @description One number with its provenance. When `value` is null, `null_reason` is set and the evidence
         *     fields should be ignored. When `evidence_kind` is `model_output` and `value` is not null,
         *     `low` and `high` are set.
         */
        Quantity: {
            value: number | null;
            /** @description For example `mm`, `degC`, `t/ha/yr`, `days`, `months`, `bu/acre`, `USD/ha/yr`, `fraction`. */
            unit: string;
            /** @description 10th percentile of the uncertainty runs. */
            low: number | null;
            /** @description 90th percentile of the uncertainty runs. */
            high: number | null;
            evidence_kind: components["schemas"]["EvidenceKind"] | null;
            access_tier: components["schemas"]["AccessTier"] | null;
            /** @description Ids from `datasets[]` that this value depends on. */
            dataset_ids: string[];
            /** @description Ground size of the coarsest dataset this value depends on. */
            native_resolution_m: number | null;
            period: components["schemas"]["Period"] | null;
            /** @description Valid observations used, for observed values. */
            n_valid_obs: number | null;
            /** @description Observations the period should have had. */
            n_expected_obs: number | null;
            null_reason: components["schemas"]["NullReason"] | null;
            /** @description One plain sentence saying what is missing and why. Always set when `value` is null. */
            null_explanation: string | null;
            /** @description True only when `null_reason` is `fetch_failed`. */
            retryable: boolean;
            /** @description True where a farmer or agronomist must confirm the value before relying on it. */
            needs_local_judgment: boolean;
            /** @description Plain-language caveat specific to this value. */
            note?: string | null;
        };
        Dataset: {
            /** @description Stable id, for example `nasa_power`, `hls`, `smap_l4`, `grace_fo`, `ssurgo`, `usda_cdl`. */
            id: string;
            name: string;
            provider: string;
            /** @description What it is used for, in plain words. */
            role: string;
            coverage_scope: components["schemas"]["CoverageScope"];
            status: components["schemas"]["DatasetStatus"];
            /** @description Set when `status` is not `available`. */
            null_reason: components["schemas"]["NullReason"] | null;
            retryable: boolean;
            /** @description Plain-language explanation when not available. */
            message: string | null;
            access_tier: components["schemas"]["AccessTier"] | null;
            evidence_kind: components["schemas"]["EvidenceKind"];
            native_resolution_m: number | null;
            /**
             * @description The source cell or cells that cover the field, for datasets coarser than the field.
             *     Null for field-scale datasets. Draw it to show how much larger than the field the source is.
             */
            footprint: components["schemas"]["Polygon"] | null;
            period: components["schemas"]["Period"] | null;
            /**
             * Format: date-time
             * @description Fetch time for `live`, snapshot creation time for `snapshot`.
             */
            as_of: string | null;
            /** Format: uri */
            source_url: string;
        };
        CoverageRequest: {
            geometry: components["schemas"]["FieldGeometry"];
        };
        Coverage: {
            field: components["schemas"]["FieldSummary"];
            datasets: components["schemas"]["Dataset"][];
            /** @description False means `farmer.current_rotation` is required. */
            crop_history_available: boolean;
        };
        Crop: {
            id: string;
            name: string;
            category: components["schemas"]["CropCategory"];
            /** @description Botanical family, used for pest-cycle breaks. */
            family: string | null;
            nitrogen_fixing: boolean;
            /** @enum {string|null} */
            rooting_depth: "shallow" | "medium" | "deep" | null;
            /** @enum {string|null} */
            water_demand: "low" | "medium" | "high" | null;
            equipment: components["schemas"]["Equipment"][];
            /** @description Climate screen at this location. Null where it cannot be judged. */
            suitable: boolean | null;
            suitability_reason: string;
            /** @description True where regional records show the crop is grown nearby. Null where no record exists. */
            grown_locally: boolean | null;
        };
        CropList: {
            location: components["schemas"]["LatLon"];
            crop_history_available: boolean;
            crops: components["schemas"]["Crop"][];
        };
        RotationYear: {
            /** @description Id from `GET /v1/crops`. Use `fallow` for a fallow year. */
            crop_id: string;
            /** @description Cover crop sown after harvest. An id of category `cover`, or null for none. */
            cover_crop_id?: string | null;
        };
        RotationInput: {
            /** @description One entry per year of the cycle, in order. */
            years: components["schemas"]["RotationYear"][];
        };
        FarmerInputs: {
            water_availability: components["schemas"]["WaterAvailability"];
            /** @description Irrigation water available per year, if the farmer knows it. */
            irrigation_allowance_mm?: number | null;
            /** @description Equipment the farmer has. Null means unknown, in which case nothing is filtered and a gap is reported. */
            equipment?: components["schemas"]["Equipment"][] | null;
            /** @description Ranked, most important first. Unranked priorities get zero weight in the overall ranking and are still reported. */
            priorities: components["schemas"]["Priority"][];
            /**
             * @description Alternatives must include a forage crop.
             * @default false
             */
            require_forage: boolean;
            /**
             * @description Only suggest crops with evidence of being grown locally.
             * @default false
             */
            local_market_only: boolean;
            excluded_crop_ids?: string[];
            preferred_crop_ids?: string[];
            /**
             * @description The farmer's own yield and selling price for a crop. Where given, they replace any published
             *     record for that crop when income is worked out. The price is in the currency the result reports
             *     in `currency`: US dollars in the United States, the country's own currency elsewhere.
             * @default []
             */
            own_figures: components["schemas"]["OwnFigures"][];
            /** @description Overrides the detected rotation. Required where no crop-history layer exists. */
            current_rotation?: components["schemas"]["RotationInput"] | null;
            /**
             * @description True once the farmer has confirmed the rotation proposed by `POST /v1/crop-history`. It
             *     changes no number; it only sets `baseline.farmer_confirmed`. A supplied `current_rotation`
             *     always counts as confirmed.
             * @default false
             */
            current_rotation_confirmed: boolean;
        };
        Scenario: {
            /** @default normal */
            rainfall: components["schemas"]["RainfallScenario"];
            /** @default normal */
            temperature: components["schemas"]["TemperatureScenario"];
        };
        FieldInput: {
            name?: string | null;
            geometry: components["schemas"]["FieldGeometry"];
        };
        AnalysisRequest: {
            field: components["schemas"]["FieldInput"];
            farmer: components["schemas"]["FarmerInputs"];
            scenario?: components["schemas"]["Scenario"];
        };
        Job: {
            analysis_id: string;
            status: components["schemas"]["JobStatus"];
            /** @description Machine id of the current stage. Ids and labels are listed in `Meta.job_stages`. */
            stage: string | null;
            /** @description Human-readable stage, for example "Fetching rainfall history". */
            stage_label: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** @description Set when `status` is `error`. */
            error: components["schemas"]["Problem"] | null;
            /** @description Set when `status` is `done`. */
            result: components["schemas"]["Analysis"] | null;
        };
        Grid: {
            /** @description Internal analysis CRS, for example `EPSG:5070`. Delivered geometry is always EPSG:4326. */
            crs: string;
            cell_size_m: number;
            n_cells: number;
        };
        FieldSummary: {
            name: string | null;
            area_ha: number;
            centroid: components["schemas"]["LatLon"];
            /** @description ISO 3166-1 alpha-2. */
            country_code: string | null;
            /** @description Scopes that apply at this field. `global` is always present. */
            coverage_scopes: components["schemas"]["CoverageScope"][];
            grid: components["schemas"]["Grid"];
        };
        ResolvedScenarioStep: {
            id: string;
            label: string;
            /** @description The rule in words, for example "A dry year that happens about one year in five here". */
            definition: string;
            /** @description What the step means at this field, for example growing-season rainfall in mm. */
            quantity: components["schemas"]["Quantity"] | null;
        };
        ResolvedScenario: {
            rainfall: components["schemas"]["ResolvedScenarioStep"];
            temperature: components["schemas"]["ResolvedScenarioStep"];
        };
        Weight: {
            priority: components["schemas"]["Priority"];
            score_id: components["schemas"]["ScoreId"];
            /** @description Position in the farmer's ranking, 1 first. Null if unranked. */
            rank: number | null;
            weight: number;
        };
        ScoreComponent: {
            id: string;
            label: string;
            higher_is_better: boolean;
            quantity: components["schemas"]["Quantity"];
        };
        /**
         * @description `value` is 0 to 100 and higher is always better. Lead with `physical` in the interface where it
         *     exists. `composite` scores combine several components and have no single physical unit.
         */
        Score: {
            id: components["schemas"]["ScoreId"];
            label: string;
            value: number | null;
            low: number | null;
            high: number | null;
            /** @constant */
            higher_is_better: true;
            composite: boolean;
            /** @description The underlying physical quantity, where one exists. */
            physical: components["schemas"]["Quantity"] | null;
            /** @description For example "Bare weeks per year" or "Seasonal water shortfall". */
            physical_label: string | null;
            physical_higher_is_better: boolean | null;
            components: components["schemas"]["ScoreComponent"][];
            /** @description Weight from the farmer's ranking used in `overall`. */
            weight: number;
            explanation: string;
            null_reason: components["schemas"]["NullReason"] | null;
            /** @description One plain sentence saying what is missing and why. Always set when `value` is null. */
            null_explanation: string | null;
            retryable: boolean;
        };
        CoverCell: {
            cycle_year: number;
            month: number;
            state: components["schemas"]["CoverState"];
            crop_id: string | null;
            /** @description Share of the month with the ground covered. Below 1 where planting or harvest falls mid-month. */
            covered_fraction: number;
        };
        /**
         * @description Twelve cells per cycle year. For the current rotation the bare months can be satellite
         *     observations. For every alternative the calendar is model output from typical planting and
         *     harvest dates.
         */
        CoverCalendar: {
            evidence_kind: components["schemas"]["EvidenceKind"];
            access_tier: components["schemas"]["AccessTier"];
            dataset_ids: string[];
            period: components["schemas"]["Period"] | null;
            n_valid_obs: number | null;
            n_expected_obs: number | null;
            cells: components["schemas"]["CoverCell"][];
            /**
             * @description Weeks of bare soil per year, averaged over the cycle. Computed from daily cover state, so
             *     it is finer than the monthly cells. Its range reflects planting and harvest date spread.
             */
            bare_weeks_per_year: components["schemas"]["Quantity"];
            /** @description Weeks per year with a crop or cover crop growing, averaged over the cycle. */
            living_cover_weeks_per_year: components["schemas"]["Quantity"];
        };
        RiskCell: {
            cycle_year: number;
            month: number;
            hazard: components["schemas"]["CalendarHazard"];
            level: components["schemas"]["RiskLevel"] | null;
            /** @description Share of years in the record in which the hazard occurred in this month while the crop was exposed. */
            share_of_years: number | null;
            exposed_crop_id: string | null;
        };
        RiskCalendar: {
            evidence_kind: components["schemas"]["EvidenceKind"];
            access_tier: components["schemas"]["AccessTier"];
            dataset_ids: string[];
            native_resolution_m: number | null;
            period: components["schemas"]["Period"] | null;
            n_years: number | null;
            cells: components["schemas"]["RiskCell"][];
            null_reason: components["schemas"]["NullReason"] | null;
            /** @description One plain sentence saying what is missing and why. Always set when `null_reason` is set. */
            null_explanation: string | null;
        };
        EvidenceItem: {
            id: string;
            /** @enum {string} */
            kind: "vegetation_stress_window" | "bare_field_window" | "soil_moisture_anomaly" | "evapotranspiration" | "water_balance" | "rainfall_reliability" | "extreme_rain" | "frost_risk" | "heat_stress" | "slope_erosion" | "soil_property" | "water_storage_trend" | "groundwater_trend" | "market_presence" | "yield_history" | "price_history";
            title: string;
            /** @description Plain language, no index names without explanation. */
            summary: string;
            quantity: components["schemas"]["Quantity"];
            /** @description Id in `Analysis.series` when a time series backs this item. */
            series_id: string | null;
        };
        Reason: {
            /** @enum {string} */
            signal: "soil" | "climate" | "water" | "bare_field" | "crop_stress" | "terrain" | "market" | "farmer_priority";
            text: string;
            evidence_ids: string[];
        };
        Benefit: {
            /** @enum {string} */
            tag: "water_saving" | "nitrogen_fixation" | "deep_rooting" | "organic_matter" | "soil_cover" | "infiltration" | "erosion_control" | "pest_cycle_break" | "forage" | "income";
            text: string;
            quantity: components["schemas"]["Quantity"] | null;
        };
        /** @description One dimension of this rotation compared with the current rotation. */
        Tradeoff: {
            score_id: components["schemas"]["ScoreId"];
            /**
             * @description Decided by the server on paired uncertainty runs, where both rotations face the same
             *     weather year, soil and crop draws. `better` or `worse`: this rotation wins or loses in
             *     nearly all runs. `uncertain`: the values differ but neither wins consistently, shown as
             *     "Too close to call". `similar`: no meaningful difference. `unknown`: one side is null.
             *     The thresholds are in `Meta.tradeoff_rule`.
             * @enum {string}
             */
            direction: "better" | "worse" | "similar" | "uncertain" | "unknown";
            /** @description Share of paired runs in which this rotation scored higher than the current one. */
            share_of_runs_better: number | null;
            /** @description This rotation's score minus the current rotation's. */
            score_delta: number | null;
            /** @description Difference in the physical quantity, signed, where both sides have one. */
            physical_delta: components["schemas"]["Quantity"] | null;
            text: string;
        };
        Gap: {
            id: string;
            text: string;
            affects: components["schemas"]["ScoreId"][];
            dataset_id: string | null;
            null_reason: components["schemas"]["NullReason"] | null;
        };
        LocalReview: {
            topic: string;
            text: string;
            /** @enum {string} */
            reviewer: "farmer" | "agronomist" | "extension_service" | "water_authority" | "buyer";
        };
        RankStability: {
            /** @description Share of uncertainty runs in which this rotation had the highest overall score. */
            share_ranked_first: number | null;
            n_runs: number;
        };
        Overall: {
            /**
             * @description Why there is no overall score. The rotations are not ranked when the farmer's first
             *     priority could not be scored for every one of them.
             */
            null_explanation: string | null;
            /** @description Weighted mean of the non-null scores under the farmer's ranking. */
            value: number | null;
            low: number | null;
            high: number | null;
            rank: number | null;
            rank_stability: components["schemas"]["RankStability"];
        };
        RotationYearResolved: {
            cycle_year: number;
            crop_id: string;
            crop_name: string;
            cover_crop_id: string | null;
        };
        /** @description What the crop map shows on the field in one year. */
        ObservedYear: {
            year: number;
            /** @description Null when no class covered half the field, or the class is not a crop this tool handles. */
            crop_id: string | null;
            /** @description The crop map's own name for the largest class that year. */
            class_name: string;
            share_of_field: number;
            /** @description Grid cells or sample points read that year. */
            n_cells: number;
        };
        DetectedRotation: {
            /** @description Can be sent back unchanged as `farmer.current_rotation.years`. */
            years: components["schemas"]["RotationYear"][];
            label: string;
            detection_basis: components["schemas"]["DetectionBasis"];
            share_of_years_consistent: components["schemas"]["Quantity"];
        };
        CropHistory: {
            field: components["schemas"]["FieldSummary"];
            crop_history_available: boolean;
            /** @description Null when no rotation could be read. `null_reason` then says why. */
            detected: components["schemas"]["DetectedRotation"] | null;
            observed_years: components["schemas"]["ObservedYear"][];
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            retryable: boolean;
        };
        CropFitCheck: {
            check: components["schemas"]["CropFitCheckId"];
            status: components["schemas"]["CropFitStatus"];
            quantity: components["schemas"]["Quantity"];
            /** @description One plain sentence with the figure that decided the status. */
            text: string;
        };
        /** @description How the field's conditions suit one crop of the rotation. The rules are in `Meta.crop_fit_checks`. */
        CropFit: {
            crop_id: string;
            crop_name: string;
            /** @description Always the four checks, in `CropFitCheckId` order. */
            checks: components["schemas"]["CropFitCheck"][];
            /**
             * @description The check that constrains this crop most here, after Liebig's law of the minimum as CropSuite v1.0 uses it
             *     (Zabel, Knüttel and Poschlod 2025, Geosci. Model Dev. 18, 1067-1087): the worst status, ties broken by how far
             *     the check's figure is past the threshold of that status, as a share of the threshold. Null when every check fits
             *     or cannot be judged.
             */
            limiting_check: components["schemas"]["CropFitCheckId"] | null;
            /** @description How often this crop would likely fail at this field. Null when no cause of failure can be judged for it. */
            failure: components["schemas"]["CropFailure"] | null;
        };
        /**
         * @description The recurrence rate of potential crop failure, after CropSuite v1.0 (Zabel, Knüttel and Poschlod 2025, Geosci. Model
         *     Dev. 18, 1067-1087), counted over weather years of the record, not over runs. A season fails on a killing frost while
         *     the crop emerges or sets grain, a sustained spell of extreme heat while it flowers, or a water shortage, given the
         *     supply the farmer stated, that costs more than half its yield (FAO-33: 1 - Ya/Ym = Ky (1 - ETa/ETc)). A weather year
         *     counts as a likely failure when at least half of the runs fail a season of the crop harvested in it; the runs differ
         *     in soil, planting date and crop within their stated ranges. Each failed year is counted once, under the cause that
         *     failed the most runs of its worst season. The thresholds are in `backend/app/core/config.py`.
         */
        CropFailure: {
            years_failed: number;
            /**
             * @description The weather years the crop is harvested in across the runs: every year of the record under normal rainfall,
             *     only the driest years under a dry rainfall scenario.
             */
            years_total: number;
            by_cause: components["schemas"]["CropFailureCauses"];
        };
        /** @description Failed years by cause. They sum to `years_failed`. */
        CropFailureCauses: {
            /** @description Null when the crop has no growth stages to judge frost by, as for a perennial. */
            frost: number | null;
            /** @description Null when the crop has no flowering stage to judge heat by, as for a perennial. */
            heat: number | null;
            /** @description Null when the field's soil values or the crop's yield response factor are missing. */
            water: number | null;
        };
        /** @description Present on the current rotation only. */
        BaselineDetection: {
            /** @description Null when the farmer supplied the rotation. */
            detection_basis: components["schemas"]["DetectionBasis"] | null;
            /** @description The crop map's year-by-year reading. Empty when the farmer supplied the rotation. */
            observed_years: components["schemas"]["ObservedYear"][];
            /** @enum {string} */
            baseline_source: "cdl_derived" | "farmer_supplied";
            farmer_confirmed: boolean;
            /** @description Share of observed years that match the detected cycle. Null when farmer supplied. */
            share_of_years_consistent: components["schemas"]["Quantity"] | null;
        };
        Rotation: {
            /** @description Crops grown per year, averaged over the cycle. A fallow year counts as none. */
            crops_per_year: number;
            id: string;
            /** @enum {string} */
            role: "current" | "alternative";
            /**
             * @description How far this rotation departs from the current one.
             * @enum {string}
             */
            change_level: "none" | "low" | "high";
            /** @description For example "Corn, then wheat, then sorghum". */
            label: string;
            years: components["schemas"]["RotationYearResolved"][];
            baseline: components["schemas"]["BaselineDetection"] | null;
            /** @description One entry per crop in the rotation, in the order grown. */
            crop_fit: components["schemas"]["CropFit"][];
            cover_calendar: components["schemas"]["CoverCalendar"];
            /** @description Always all six, in `ScoreId` order. */
            scores: components["schemas"]["Score"][];
            overall: components["schemas"]["Overall"];
            why_suggested: components["schemas"]["Reason"][];
            evidence: components["schemas"]["EvidenceItem"][];
            benefits: components["schemas"]["Benefit"][];
            /** @description Empty for the current rotation. */
            tradeoffs: components["schemas"]["Tradeoff"][];
            risk_calendar: components["schemas"]["RiskCalendar"];
            gaps: components["schemas"]["Gap"][];
            local_review: components["schemas"]["LocalReview"][];
        };
        SeriesPoint: {
            /**
             * Format: date
             * @description Start of the period.
             */
            t: string;
            value: number | null;
            n_valid_obs: number | null;
            n_expected_obs: number | null;
        };
        Series: {
            id: string;
            label: string;
            unit: string;
            /** @enum {string} */
            cadence: "daily" | "sixteen_day" | "monthly" | "yearly";
            evidence_kind: components["schemas"]["EvidenceKind"];
            access_tier: components["schemas"]["AccessTier"];
            dataset_ids: string[];
            native_resolution_m: number | null;
            points: components["schemas"]["SeriesPoint"][];
        };
        /**
         * @description A satellite or model value beside a ground measurement of the same thing. The two are never
         *     merged. `difference` is present only when `comparison_basis` is `same_unit_value`.
         */
        SatelliteGroundPair: {
            id: string;
            label: string;
            satellite: components["schemas"]["Quantity"];
            ground: components["schemas"]["Quantity"];
            /** @enum {string} */
            comparison_basis: "same_unit_value" | "trend_direction" | "none";
            /** @enum {string} */
            agreement: "consistent" | "differs" | "not_comparable";
            difference: components["schemas"]["Quantity"] | null;
            /** @description The test that decided `agreement`, in words. */
            rule: string;
            ground_site_count: number | null;
            /** @description Distance from the field to the nearest ground site used. */
            ground_distance_km: number | null;
        };
        UncertaintyDriver: {
            /** @enum {string} */
            id: "weather_variability" | "soil_properties" | "crop_parameters" | "rainfall_source_disagreement";
            label: string;
            /** @description Share of the spread in the overall score attributable to this source. */
            share: number | null;
        };
        Uncertainty: {
            method: string;
            n_runs: number;
            /** @constant */
            interval: "p10_p90";
            seed: string;
            drivers: components["schemas"]["UncertaintyDriver"][];
        };
        ZoneSummary: {
            hazard: components["schemas"]["ZoneHazard"];
            available: boolean;
            /** @description True when the source cannot separate parts of the field, so the whole field is one class. */
            field_wide: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
        };
        OwnFigures: {
            /** @description A single crop from `GET /v1/crops`, not a two-crops-a-year pair. */
            crop_id: string;
            yield_t_per_ha: number;
            price_per_tonne: number;
        };
        CloseCall: {
            /** @description The first-ranked rotation, then every rotation it is not clearly ahead of, in rank order. Can include what is grown now. */
            rotation_ids: string[];
            /** @description Share of paired runs in which the first-ranked rotation scored higher than the closest of the others. */
            share_of_runs_first_ahead: number;
            text: string;
        };
        /** @description The currency every money figure in the result is in. */
        Currency: {
            /** @description ISO 4217 code, for example `USD`, `PHP`, `THB`. */
            code: string;
            name: string;
        };
        Analysis: {
            currency: components["schemas"]["Currency"];
            /**
             * @description Set when the first-ranked rotation is not clearly ahead of another: it scored higher in fewer
             *     than three of four paired runs, or the two are under two points apart. Say so with the ranking
             *     instead of naming one winner. Null when the first-ranked rotation is clearly ahead of every other.
             */
            close_call: components["schemas"]["CloseCall"] | null;
            /**
             * @description Set when something the farmer ranked could not be scored, so the ranking leaves it out.
             *     Show it with the ranking, not in a drawer. Null when everything ranked was scored.
             */
            ranking_note: string | null;
            contract_version: string;
            analysis_id: string;
            /** Format: date-time */
            created_at: string;
            /** @description The statement that the tool supports and does not replace local expertise. */
            disclaimer: string;
            request: components["schemas"]["AnalysisRequest"];
            field: components["schemas"]["FieldSummary"];
            datasets: components["schemas"]["Dataset"][];
            scenario: components["schemas"]["ResolvedScenario"];
            weights: components["schemas"]["Weight"][];
            /** @description The current rotation first, then alternatives by overall rank. */
            rotations: components["schemas"]["Rotation"][];
            /** @description Conditions of the field that hold whatever is grown. */
            field_evidence: components["schemas"]["EvidenceItem"][];
            series: components["schemas"]["Series"][];
            comparisons: components["schemas"]["SatelliteGroundPair"][];
            /** @description Which zone layers exist. Geometry is at `GET /v1/analyses/{analysis_id}/zones`. */
            zones: components["schemas"]["ZoneSummary"][];
            uncertainty: components["schemas"]["Uncertainty"];
            /** @description Gaps that apply to the whole analysis. */
            gaps: components["schemas"]["Gap"][];
        };
        /** @enum {string} */
        ReasoningStepId: "field" | "conditions" | "crop_fit" | "runs" | "scores" | "weights" | "ranking";
        /** @description One value read from the analysis result, with the field it was read from. */
        ReasoningFact: {
            /** @description The rotation, crop or set the fact belongs to. Null when the step has a single set. */
            group: string | null;
            label: string;
            /**
             * @description The value in words, rounded as shown. It can add the unit, range or sentence that sits
             *     beside the value in the same item of the result.
             */
            text: string;
            /** @description The number at `source`, unrounded. Null when the fact is words or a period. */
            value: number | null;
            /**
             * @description Where in the analysis result the fact was read, for example
             *     `field_evidence[id=rainfall].quantity.value`. `[key=value]` picks the list item whose `key` is `value`.
             */
            source: string;
            /** @description Ids from `datasets[]` behind the fact. Empty for the farmer's answers and the engine's own results. */
            dataset_ids: string[];
        };
        ReasoningStep: {
            id: components["schemas"]["ReasoningStepId"];
            title: string;
            /** @description What the engine does in this step, in plain words. */
            method: string;
            facts: components["schemas"]["ReasoningFact"][];
        };
        /**
         * @description `not_configured`: no language model is set up; the engine wrote the summary.
         *     `accepted`: the model's reply passed every check and is the summary.
         *     `rejected`: the reply failed a check; the engine's summary is shown and `status_note` says why.
         *     `failed`: the model did not answer in time or its answer could not be read; the engine's summary is shown.
         * @enum {string}
         */
        SummaryStatus: "not_configured" | "accepted" | "rejected" | "failed";
        ReasoningSummary: {
            /** @description Written by the model when `status` is `accepted`, by the engine otherwise. */
            text: string;
            status: components["schemas"]["SummaryStatus"];
            /** @description The language model asked, for example `openai/gpt-4o-mini`. Null when none is set up. */
            model: string | null;
            /** @description Why the model's reply is not shown, in one plain sentence. Null unless `status` is `rejected` or `failed`. */
            status_note: string | null;
            /** @description The exact lines the model was given, one fact each. Empty when no model is set up. */
            facts_given: string[];
        };
        Reasoning: {
            analysis_id: string;
            steps: components["schemas"]["ReasoningStep"][];
            summary: components["schemas"]["ReasoningSummary"];
        };
        ZoneClass: {
            index: components["schemas"]["RiskLevel"];
            label: string;
            min: number | null;
            max: number | null;
        };
        ZoneFeature: {
            /** @constant */
            type: "Feature";
            geometry: components["schemas"]["Polygon"] | components["schemas"]["MultiPolygon"];
            properties: {
                class_index: components["schemas"]["RiskLevel"];
                /** @description Mean raw value in the zone, in the legend unit. */
                value: number | null;
                area_ha: number;
            };
        };
        ZoneFeatureCollection: {
            /** @constant */
            type: "FeatureCollection";
            features: components["schemas"]["ZoneFeature"][];
        };
        ZoneLayer: {
            hazard: components["schemas"]["ZoneHazard"];
            label: string;
            field_wide: boolean;
            evidence_kind: components["schemas"]["EvidenceKind"] | null;
            access_tier: components["schemas"]["AccessTier"] | null;
            dataset_ids: string[];
            native_resolution_m: number | null;
            period: components["schemas"]["Period"] | null;
            n_valid_obs: number | null;
            n_expected_obs: number | null;
            unit: string | null;
            /** @description Class breaks for the legend. */
            classes: components["schemas"]["ZoneClass"][];
            null_reason: components["schemas"]["NullReason"] | null;
            /** @description One plain sentence saying what is missing and why. Always set when `features` is null. */
            null_explanation: string | null;
            retryable: boolean;
            needs_local_judgment: boolean;
            features: components["schemas"]["ZoneFeatureCollection"] | null;
        };
        ZoneLayers: {
            analysis_id: string;
            grid: components["schemas"]["Grid"];
            /** @description One per hazard, always all four. */
            layers: components["schemas"]["ZoneLayer"][];
        };
        ContextLayer: {
            id: string;
            title: string;
            kind: components["schemas"]["LayerKind"];
            /** @description The product shown. A label, not a key into an analysis's `datasets[]`. */
            dataset_id: string;
            /**
             * @description Web Mercator tile template with `{z}`, `{x}`, `{y}` and, when `time` is set, `{time}`. A
             *     layer rendered on request uses `{bbox-epsg-3857}` in place of the three tile tokens.
             */
            url_template: string;
            /** @description For example "Public domain" or "CC BY-NC-SA 4.0". Null where the publisher states none. */
            license: string | null;
            /** Format: uri */
            license_url: string | null;
            /** @description Id of the layer this one sharpens at close zoom. Draw it over that layer from `min_zoom` up. */
            detail_of: string | null;
            tile_size: number;
            min_zoom: number;
            max_zoom: number;
            attribution: string;
            coverage_scope: components["schemas"]["CoverageScope"];
            native_resolution_m: number | null;
            /** @constant */
            pre_rendered: true;
            time: {
                /** Format: date */
                default: string;
                /** Format: date */
                start: string;
                /** Format: date */
                end: string;
                /** @enum {string} */
                step: "day" | "month";
            } | null;
            /** Format: uri */
            legend_url: string | null;
        };
        LayerList: {
            location: components["schemas"]["LatLon"];
            layers: components["schemas"]["ContextLayer"][];
        };
        OutlookDay: {
            /** @description Chance of rain that day, 0 to 1. */
            rain_chance: number | null;
            /** Format: date */
            date: string;
            t_max_c: number;
            t_min_c: number;
            rain_mm: number;
            /** @description The forecast minimum is at or below the frost threshold served by meta. */
            frost: boolean;
            /** @description The forecast maximum is at or above the heat threshold served by meta. */
            heat: boolean;
        };
        Outlook: {
            location: components["schemas"]["LatLon"];
            available: boolean;
            dataset_id: string;
            provider: string;
            /** Format: uri */
            source_url: string;
            evidence_kind: components["schemas"]["EvidenceKind"];
            access_tier: components["schemas"]["AccessTier"];
            /**
             * Format: date-time
             * @description When the forecast was fetched.
             */
            issued_at: string | null;
            days: components["schemas"]["OutlookDay"][];
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            retryable: boolean;
            note: string;
        };
        /** @description Rain that has fallen lately, from the daily weather record. The record runs a few days behind. */
        BriefingRecentRain: {
            available: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            dataset_ids: string[];
            last_7_days_mm: number | null;
            last_30_days_mm: number | null;
            /** Format: date */
            last_real_rain_date: string | null;
            /** Format: date */
            read_through: string | null;
        };
        /** @description How wet the soil is on a scale from 0, completely dry, to 1, saturated. It is not a share of the soil's volume. One value for a weather cell about 55 km wide. */
        BriefingSoilWetness: {
            available: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            dataset_ids: string[];
            now: number | null;
            usual: number | null;
            usual_low: number | null;
            usual_high: number | null;
            /** Format: date */
            read_on: string | null;
        };
        /** @description Water a well-watered crop cover would lose over the next seven days, from the forecast. */
        BriefingWeekWater: {
            available: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            dataset_ids: string[];
            loss_mm: number | null;
            basis: string | null;
        };
        /** @description What next month usually brings, from the long record. Not a seasonal forecast. */
        BriefingMonthOutlook: {
            available: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            dataset_ids: string[];
            month: number | null;
            rain_mm: number | null;
            rain_basis: string | null;
            coldest_night_c: number | null;
            coldest_night_basis: string | null;
            frost_share_of_years: number | null;
            frost_basis: string | null;
            usual_pattern: boolean;
        };
        /** @description The long weather record in a few numbers. */
        BriefingYearClimate: {
            available: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            dataset_ids: string[];
            usual_rain_mm: number | null;
            dry_year_mm: number | null;
            interval: string | null;
            monthly_rain_mm: number[] | null;
            hot_days_per_year: number | null;
            frost_days_per_year: number | null;
            hottest_day_c: number | null;
            coldest_night_c: number | null;
            record_years: string | null;
        };
        /**
         * @description Which crops are in their sowing window, checked against the forecast, topsoil wetness and what
         *     next month usually brings. In the United States the window is the weeks in which the middle 80%
         *     of the state's crop was planted, from USDA crop progress reports. Elsewhere it is a general
         *     reference date. The weather rules are simple conventions, so this is always for local judgment.
         */
        BriefingCropAdvice: {
            /** @description Where the planting dates come from, in words for the farmer. */
            basis: string | null;
            needs_local_judgment: boolean;
            available: boolean;
            null_reason: components["schemas"]["NullReason"] | null;
            null_explanation: string | null;
            dataset_ids: string[];
            crops: {
                crop_id: string;
                name: string;
                verdict: string;
                good: boolean;
                reason: string;
            }[];
            action: string | null;
        };
        Briefing: {
            location: components["schemas"]["LatLon"];
            /** Format: date */
            as_of: string;
            forecast: components["schemas"]["Outlook"];
            recent_rain: components["schemas"]["BriefingRecentRain"];
            soil_surface: components["schemas"]["BriefingSoilWetness"];
            soil_root_zone: components["schemas"]["BriefingSoilWetness"];
            week_water: components["schemas"]["BriefingWeekWater"];
            month_outlook: components["schemas"]["BriefingMonthOutlook"];
            year_climate: components["schemas"]["BriefingYearClimate"];
            sow_this_week: components["schemas"]["BriefingCropAdvice"];
            plant_this_month: components["schemas"]["BriefingCropAdvice"];
        };
        Label: {
            id: string;
            label: string;
            description: string;
        };
        ScoreDefinition: {
            id: components["schemas"]["ScoreId"];
            label: string;
            description: string;
            composite: boolean;
            physical_label: string | null;
            physical_unit: string | null;
            physical_higher_is_better: boolean | null;
            priority: components["schemas"]["Priority"];
        };
        /**
         * @description Display labels are locked with the design system and served only from here:
         *     - evidence kinds: Satellite, Ground reading, Soil survey baseline, Model output
         *     - null reasons: No coverage, Not set up, Too few readings, Could not load
         *     - needs_local_judgment: Check locally
         *     - risk levels 0, 1, 2: Lower, Raised, High
         *     - cover states: Crop, Cover crop, Stubble, Bare
         *     - calendar hazards: Frost while a crop is vulnerable, Heat while a crop is vulnerable,
         *       Dry spell while a crop is growing, Heavy rain, Bare soil
         *     - rainfall scenarios: Normal, Dry, Very dry. Temperature scenarios: Normal, Warm, Hot
         *     - tradeoff direction `uncertain`: Too close to call
         */
        Meta: {
            contract_version: string;
            disclaimer: string;
            interval: {
                /** @constant */
                id: "p10_p90";
                description: string;
            };
            /** @description Exactly four. */
            evidence_kinds: components["schemas"]["Label"][];
            access_tiers: components["schemas"]["Label"][];
            /** @description The label for `out_of_coverage` is "No coverage". */
            null_reasons: components["schemas"]["Label"][];
            needs_local_judgment: components["schemas"]["Label"];
            scores: components["schemas"]["ScoreDefinition"][];
            priorities: components["schemas"]["Label"][];
            zone_hazards: components["schemas"]["Label"][];
            calendar_hazards: components["schemas"]["Label"][];
            risk_levels: components["schemas"]["Label"][];
            rainfall_scenarios: components["schemas"]["Label"][];
            temperature_scenarios: components["schemas"]["Label"][];
            cover_states: components["schemas"]["Label"][];
            job_stages: components["schemas"]["Label"][];
            equipment: components["schemas"]["Label"][];
            tradeoff_directions: components["schemas"]["Label"][];
            crop_fit_statuses: components["schemas"]["Label"][];
            /** @description Each description states the rule that decides the status, with its thresholds. */
            crop_fit_checks: components["schemas"]["Label"][];
            layer_kinds: components["schemas"]["Label"][];
            detection_bases: components["schemas"]["Label"][];
            /** @description The thresholds that decide `Tradeoff.direction`. */
            tradeoff_rule: {
                /** @description At or above this share of paired runs won, the direction is `better`. */
                better_share_min: number;
                /** @description At or below this share, the direction is `worse`. */
                worse_share_max: number;
                /** @description Below this absolute median score difference, the direction is `similar`. */
                similar_score_delta_max: number;
                /** @description The rule in plain words. */
                description: string;
            };
        };
        Health: {
            /** @constant */
            status: "ok";
            contract_version: string;
        };
        ProblemField: {
            /** @description JSON pointer into the request body. */
            field: string;
            message: string;
        };
        Problem: {
            /** @description Stable error identifier, for example `field_too_large`, `rotation_required`, `unknown_crop`, `not_found`, `not_finished`, `insufficient_candidates`, `internal`. */
            type: string;
            title: string;
            status: number;
            detail: string;
            errors?: components["schemas"]["ProblemField"][];
        };
    };
    responses: {
        /** @description Request-level error (RFC 9457). */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        Lat: number;
        Lon: number;
        AnalysisId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Service is up. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getMeta: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Vocabulary. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Meta"];
                };
            };
        };
    };
    checkCoverage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CoverageRequest"];
            };
        };
        responses: {
            /** @description Per-dataset availability for the field. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Coverage"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    getCropHistory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CoverageRequest"];
            };
        };
        responses: {
            /** @description The year-by-year crop history and the rotation read from it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CropHistory"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    listCrops: {
        parameters: {
            query: {
                lat: components["parameters"]["Lat"];
                lon: components["parameters"]["Lon"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accepted crops with suitability at the location. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CropList"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    listLayers: {
        parameters: {
            query: {
                lat: components["parameters"]["Lat"];
                lon: components["parameters"]["Lon"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Context layers available at the location. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LayerList"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    getOutlook: {
        parameters: {
            query: {
                lat: components["parameters"]["Lat"];
                lon: components["parameters"]["Lon"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The outlook, or the reason there is none. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Outlook"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    getBriefing: {
        parameters: {
            query: {
                lat: components["parameters"]["Lat"];
                lon: components["parameters"]["Lon"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The briefing. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Briefing"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    createAnalysis: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnalysisRequest"];
            };
        };
        responses: {
            /** @description Job accepted. */
            202: {
                headers: {
                    /** @description URL of the job. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            422: components["responses"]["Problem"];
            429: components["responses"]["Problem"];
        };
    };
    getAnalysis: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                analysis_id: components["parameters"]["AnalysisId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Job state. `result` is present only when `status` is `done`. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            404: components["responses"]["Problem"];
        };
    };
    getZones: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                analysis_id: components["parameters"]["AnalysisId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zone layers. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ZoneLayers"];
                };
            };
            404: components["responses"]["Problem"];
            /** @description The analysis is not finished. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getReasoning: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                analysis_id: components["parameters"]["AnalysisId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The steps and the summary. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Reasoning"];
                };
            };
            404: components["responses"]["Problem"];
            /** @description The analysis is not finished. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
