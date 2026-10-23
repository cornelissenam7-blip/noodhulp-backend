<?php
/** Plugin Name: Amcinova betaalde campagnebestellingen
 * Configure AMC_SALES_ENDPOINT, AMC_SALES_SHOP and AMC_SALES_SECRET in wp-config.php.
 * Consent-first, first-party WC session only; no tracking cookie is created by this plugin.
 * Place [amcinova_campaign_consent] on landing page. Without explicit consent no attribution is stored.
 */
if (!defined('ABSPATH')) exit;
add_shortcode('amcinova_campaign_consent', function () {
 if (empty($_GET['amc_track'])) return '';
 $token=sanitize_text_field(wp_unslash($_GET['amc_track']));
 if(strlen($token)>1800) return '';
 return '<form method="post">'.wp_nonce_field('amc_campaign','amc_nonce',true,false).'<input type="hidden" name="amc_token" value="'.esc_attr($token).'"><label><input required type="checkbox" name="amc_consent" value="1"> Ik geef toestemming om mijn aankoop gedurende 24 uur aan deze campagne te koppelen.</label><button>Toestemming opslaan</button></form>';
});
add_action('template_redirect',function(){
 if(empty($_POST['amc_consent'])||empty($_POST['amc_nonce'])||!wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['amc_nonce'])),'amc_campaign')||!function_exists('WC')||!WC()->session)return;
 $token=sanitize_text_field(wp_unslash($_POST['amc_token']??''));
 if(strlen($token)>1800||!preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/D',$token))return;
 WC()->session->set('amc_campaign',['token'=>$token,'until'=>time()+DAY_IN_SECONDS]);
 WC()->session->set_customer_session_cookie(true);
 // Explicit consent: register only the signed campaign marker, never customer details.
 if(defined('AMC_SALES_ENDPOINT'))wp_remote_post(preg_replace('#/api/marketing/sales$#','/api/tracking/event',AMC_SALES_ENDPOINT),['timeout'=>8,'redirection'=>0,'headers'=>['Content-Type'=>'application/json'],'body'=>wp_json_encode(['token'=>$token,'type'=>'visit','eventId'=>wp_generate_uuid4(),'page'=>home_url('/'),'consent'=>true])]);
 wp_safe_redirect(remove_query_arg('amc_track'));exit;
});
function amc_attach_campaign($order){
 if(!WC()->session)return;
 $v=WC()->session->get('amc_campaign');
 if(!is_array($v)||($v['until']??0)<time())return;
 $order->update_meta_data('_amc_campaign_token',$v['token']);
 $order->update_meta_data('_amc_campaign_consent','yes');
}
add_action('woocommerce_checkout_create_order','amc_attach_campaign');
add_action('woocommerce_store_api_checkout_update_order_meta','amc_attach_campaign');
function amc_schedule_sale($id){if(function_exists('as_enqueue_async_action'))as_enqueue_async_action('amc_send_sale',['order_id'=>$id],'amcinova');}
add_action('woocommerce_payment_complete','amc_schedule_sale');
add_action('woocommerce_order_status_completed','amc_schedule_sale');
add_action('woocommerce_order_status_processing','amc_schedule_sale');
add_action('woocommerce_order_refunded',function($id){amc_schedule_sale($id);});
add_action('amc_send_sale',function($id){
 if(!defined('AMC_SALES_ENDPOINT')||!defined('AMC_SALES_SHOP')||!defined('AMC_SALES_SECRET'))return;
 if(wp_parse_url(AMC_SALES_ENDPOINT,PHP_URL_SCHEME)!=='https')return;
 $o=wc_get_order($id);if(!$o||!$o->get_date_paid()||$o->get_meta('_amc_campaign_consent')!=='yes')return;
 $paid=(int)round((float)$o->get_total()*100);$refund=(int)round((float)$o->get_total_refunded()*100);
 $snapshot=hash('sha256',$paid.':'.$refund.':'.$o->get_currency());
 if($o->get_meta('_amc_sales_sent')===$snapshot)return;
 // Monotonic revision from cumulative refund cents: stable across retries and out-of-order callbacks.
 $revision=$refund+1;
 $test=apply_filters('amcinova_sales_test_order',($o->get_meta('_amc_test_order')==='yes'||$o->get_meta('_mollie_payment_mode')!=='live'),$o);
 $body=wp_json_encode(['orderId'=>(string)$id,'revision'=>$revision,'paidCents'=>$paid,'refundedCents'=>$refund,'currency'=>$o->get_currency(),'test'=>(bool)$test,'token'=>$o->get_meta('_amc_campaign_token'),'consent'=>true]);
 $ts=(string)time();$r=wp_remote_post(AMC_SALES_ENDPOINT,['timeout'=>15,'redirection'=>0,'headers'=>['Content-Type'=>'application/json','X-Amcinova-Shop'=>AMC_SALES_SHOP,'X-Amcinova-Timestamp'=>$ts,'X-Amcinova-Signature'=>hash_hmac('sha256',$ts.'.'.$body,AMC_SALES_SECRET)],'body'=>$body]);
 if(!is_wp_error($r)&&wp_remote_retrieve_response_code($r)===200){$result=json_decode(wp_remote_retrieve_body($r),true);if(!empty($result['ok'])){$o->update_meta_data('_amc_sales_sent',$snapshot);$o->save();return;}}
 // Action Scheduler retries are bounded and payload contains only an internal order ID.
 $attempt=(int)$o->get_meta('_amc_sales_attempts');if($attempt<8&&function_exists('as_schedule_single_action')){$o->update_meta_data('_amc_sales_attempts',$attempt+1);$o->save();as_schedule_single_action(time()+min(3600,60*(2**$attempt)),'amc_send_sale',['order_id'=>$id],'amcinova');}
});
// Automatically display the consent form on a candidate signed link, without storing attribution.
add_action('wp_footer',function(){if(!empty($_GET['amc_track'])&&function_exists('WC')&&WC()->session){$v=WC()->session->get('amc_campaign');if(!is_array($v)||($v['until']??0)<time())echo '<aside aria-label="Campagnemeting">'.do_shortcode('[amcinova_campaign_consent]').'</aside>';}});

// Private connection diagnostic. This never creates an order or a sales receipt.
add_action('admin_menu',function(){add_submenu_page('woocommerce','Amcinova campagnemeting','Amcinova campagnemeting','manage_woocommerce','amcinova-campagnemeting',function(){
 if(!current_user_can('manage_woocommerce'))return;
 echo '<div class="wrap"><h1>Amcinova campagnemeting</h1><p>De marketingproef blijft privé. Alleen na uitdrukkelijke toestemming worden campagne en betaalde bestelling gekoppeld. Klantnamen en e-mailadressen worden niet doorgestuurd.</p>';
 if(!empty($_POST['amc_check_connection'])){check_admin_referer('amc_check_connection');$body=wp_json_encode(['check'=>true]);$ts=(string)time();
  $r=wp_remote_post(AMC_SALES_ENDPOINT.'/check',['timeout'=>15,'redirection'=>0,'headers'=>['Content-Type'=>'application/json','X-Amcinova-Shop'=>AMC_SALES_SHOP,'X-Amcinova-Timestamp'=>$ts,'X-Amcinova-Signature'=>hash_hmac('sha256',$ts.'.'.$body,AMC_SALES_SECRET)],'body'=>$body]);
  $data=is_wp_error($r)?[]:json_decode(wp_remote_retrieve_body($r),true);$ok=!is_wp_error($r)&&wp_remote_retrieve_response_code($r)===200&&!empty($data['connected']);
  echo '<div class="notice '.($ok?'notice-success':'notice-error').'"><p>'.($ok?'Verbinding met Amcinova bevestigd. Dit is nog geen bewijs van een betaalde proefbestelling.':'Verbinding niet bevestigd. Controleer de serverinstelling en probeer later opnieuw.').'</p></div>';
 }
 echo '<form method="post">';wp_nonce_field('amc_check_connection');echo '<button class="button button-primary" name="amc_check_connection" value="1">Controleer serververbinding</button></form></div>';
});});
