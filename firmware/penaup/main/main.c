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
 * FileName : main.c
 * Author: kiritro  Version: v0.1  Date: 2026/4/4
 * Description: Function introduction
 * ChangeLog: Change Notes
 *
*********************************************************************/

/*********************************************************************
 * INCLUDES
 */
#include <stdio.h>
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "sys_init.h"

/*********************************************************************
 * MACROS
 */


/*********************************************************************
* TYPEDEFS
*/


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



/**
 * [app_main description]
 */
void app_main(void)
{
    film_sys_init();
}
