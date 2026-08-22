/*********************************************************************
 *
 * Historical source attribution:
 *   Original source: Copyright (c) 2026 kiritro
 *   Original source license: GPL-3.0-or-later
 *
 * Modifications and new material:
 *   Copyright (c) 2026 poboll
 *   LicenseRef-Poboll-NonCommercial
 *
 * Historical portions retain their original license until written
 * rights-transfer evidence is recorded. See LICENSE and docs/legal/provenance.md.
 *
 *
 * FileName : /film_sys/src/sys_com.c
 * Author: Kiritro  Version: v0.1  Date: 2026/4/30
 * Description: Common functions
 * ChangeLog: Change Notes
 *
 *********************************************************************/

/*********************************************************************
 * INCLUDES
 */
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

#include "sys_com.h"
#include "sys_log.h"

/*********************************************************************
 * MACROS
 */


/*********************************************************************
* TYPEDEFS
*/
#define COMMON_TAG                    "common"

/*********************************************************************
 * CONSTANTS
 */


/*********************************************************************
 * LOCAL VARIABLES
 */


/*********************************************************************
 * GLOBAL VARIABLES
 */


/*********************************************************************
 * LOCAL FUNCTIONS
 */


/*********************************************************************
 * GLOBAL FUNCTIONS
 */


void sys_reboot(void)
{
    sys_logw(COMMON_TAG, "sys restart!");
    esp_restart();
    vTaskDelay(100);
    esp_restart();
}
