import { Express } from 'express'
import { state } from '../reducers/store'

/**
 * Health report as described in internal NRK blaabok spec
 */
interface HealthReport {
    /** Overordnet status på det kjørende systemet. Se Registrerte Definerte Verdier STATUS. */
    status: Status
    /** Navn på det kjørende systemet (Må være statisk! dvs ikke inneholde data om feks timings el.). */
    name: string
    /** Tidspunkt for når innholdet i rapporten ble oppdatert eller rapporten ble generert. Format: Timestamps. */
    updated: string
    /** Hvor finner du dokumentasjonen til systemet. */
    documentation: string
    /** Hvilken version av helsesjekk standard er implementert. */
    version: '5'

    // internal fields (not according to spec, but sofie uses these):
    _internal: {
        // statusCode: StatusCode,
        statusCodeString: string
        messages: Array<string>
        versions: { [component: string]: string }
    }
}
enum Status {
    OK = 'OK',
    Warning = 'WARNING',
    Fail = 'FAIL',
    Undefined = 'UNDEFINED',
}

export function setupHealthEndpoint(app: Express) {
    app.get('/health', (req, res) => {
        const health: HealthReport = {
            status: Status.OK,
            name: 'Sisyfos',
            updated: new Date().toISOString(),
            documentation:
                'https://github.com/nrkno/sofie-sisyfos-audio-controller',
            version: '5',
            _internal: {
                statusCodeString: 'OK',
                messages: [],
                versions: {
                    sisyfos: process.env.npm_package_version,
                },
            },
        }

        const isOnline = state.settings[0].serverOnline
        if (!isOnline) {
            health.status = Status.Warning
            health._internal.statusCodeString = 'WARNING'
            health._internal.messages.push('Mixer disconnected')
        }

        res.json(health)
        res.status(200)
        res.end()
    })
}

